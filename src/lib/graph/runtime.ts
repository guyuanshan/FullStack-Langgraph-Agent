import {
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { appendToolAuditLog } from "../audit/log";
import {
  appendToolError,
  callModelNode,
  executeSingleToolCall,
  hasToolMessage,
  parseToolCallArgs,
  shouldContinue,
} from "../agent/nodes";
import type { ToolConfirmationResume } from "../agent/confirmation";
import { createAgentState, type AgentState } from "../agent/state";
import type { ProviderMessage } from "../ai/providers/types";
import {
  getTenantCheckpoint,
  requireSessionInTenant,
  upsertTenantCheckpoint,
} from "../db/tenant-access";
import { evaluateToolAuthorization } from "../tools/authorization";
import { summarizeToolArgs } from "../tools/summary";
import { AgentGraphState, type GraphAgentState } from "./state";
import { updateToolCallOutcome } from "../tools/tool-call-store";
import { upsertToolCallStart } from "../tools/tool-call-store";
import { buildApprovalPayload } from "../api/pending-approvals";
import {
  appendErrorLog,
  appendInterruptEvent,
  completeAgentStep,
  createAgentStep,
} from "../observability/store";

function requireStateTenantId(state: { tenantId: string | null }) {
  if (!state.tenantId) {
    throw new Error("tenantId is required on agent state for tenant-scoped writes");
  }

  return state.tenantId;
}

function requireStateAuth(state: { auth: AgentState["auth"] }) {
  if (!state.auth) {
    throw new Error("AuthContext is required on agent state");
  }

  return state.auth;
}

const memorySaver = new MemorySaver();

function cloneAgentState(state: GraphAgentState): AgentState {
  return {
    auth: state.auth,
    runId: state.runId,
    activeStepId: state.activeStepId,
    tenantId: state.tenantId,
    sessionId: state.sessionId,
    messages: structuredClone(state.messages),
    step: state.step,
    maxSteps: state.maxSteps,
    toolCalls: structuredClone(state.toolCalls),
    assistantContent: state.assistantContent,
    reasoningContent: state.reasoningContent,
    events: structuredClone(state.events ?? []),
    assistantMessage: structuredClone(state.assistantMessage),
    currentNode: state.currentNode,
    lastNode: state.lastNode,
    completionReason: state.completionReason,
  };
}

async function runModelDraft(state: GraphAgentState) { // 调用模型节点的函数，处理与模型交互的逻辑
  const nextState = cloneAgentState(state);
  const stepId = nextState.runId
    ? await createAgentStep({
        runId: nextState.runId,
        tenantId: nextState.tenantId,
        sessionId: nextState.sessionId,
        agentName: "assistant",
        nodeName: "callModelNode",
        stepType: "model_node",
        input: {
          step: nextState.step,
          messageCount: nextState.messages.length,
        },
      })
    : null;

  try {
    nextState.activeStepId = stepId;
    await callModelNode(nextState);
    nextState.activeStepId = null;
    if (stepId) {
      await completeAgentStep({
        stepId,
        tenantId: requireStateTenantId(nextState),
        sessionId: nextState.sessionId,
        runId: nextState.runId,
        output: {
          toolCallCount: nextState.toolCalls.length,
          completionReason: nextState.completionReason,
        },
      });
    }
  } catch (error) {
    nextState.activeStepId = null;
    if (stepId) {
      await completeAgentStep({
        stepId,
        tenantId: requireStateTenantId(nextState),
        sessionId: nextState.sessionId,
        runId: nextState.runId,
        status: "error",
        output: {
          completionReason: "error",
        },
      });
    }
    if (nextState.runId) {
      await appendErrorLog({
        runId: nextState.runId,
        tenantId: nextState.tenantId,
        stepId,
        sessionId: nextState.sessionId,
        source: "callModelNode",
        error,
        context: {
          step: nextState.step,
        },
      });
    }
    throw error;
  }
  return {
    ...nextState,
    events: nextState.events,
  };
}

async function runToolsDraft(state: GraphAgentState) { // 执行工具节点的函数，处理工具调用的逻辑
  const nextState = cloneAgentState(state); // 克隆当前状态以进行修改
  nextState.lastNode = "tools"; // 更新上一个节点为工具节点
  const stepId = nextState.runId
    ? await createAgentStep({
        runId: nextState.runId,
        tenantId: nextState.tenantId,
        sessionId: nextState.sessionId,
        agentName: "assistant",
        nodeName: "executeToolsNode",
        stepType: "tool_node",
        input: {
          toolCalls: nextState.toolCalls.map((toolCall) => toolCall.function.name),
        },
      })
    : null;

  try {
    nextState.activeStepId = stepId;
    for (const toolCall of nextState.toolCalls) { // 遍历工具调用列表，逐个执行工具调用
      if (hasToolMessage(nextState, toolCall.id)) { // 如果当前工具调用已经有对应的消息，说明它已经被处理过了，直接跳过继续下一个工具调用
        continue;
      }

      const toolName = toolCall.function.name; // 获取工具调用的工具名称
      const args = parseToolCallArgs(toolCall);// 解析工具调用的参数
      const authorization = await evaluateToolAuthorization({
        auth: requireStateAuth(nextState),
        sessionId: nextState.sessionId ?? "",
        toolName,
        args,
      });
      const riskLevel = authorization.decision.riskLevel;
      const permissions = authorization.permissions;

      if (authorization.decision.action === "deny") {
        await executeSingleToolCall(nextState, toolCall, args);
        continue;
      }

      if (authorization.decision.action === "require_approval") { // 如果工具的风险级别需要确认，发送一个中断请求等待用户确认是否执行工具
        const toolSummary =
          authorization.summary ?? summarizeToolArgs(args);
        const message =
          riskLevel === "dangerous"
            ? `危险操作：是否允许执行工具 ${toolName}？`
            : `是否允许执行工具 ${toolName}？`;

        if (nextState.sessionId) {
          await requireSessionInTenant(
            requireStateTenantId(nextState),
            nextState.sessionId
          );
        }
        await upsertToolCallStart({
          sessionId: nextState.sessionId,
          tenantId: nextState.tenantId,
          runId: nextState.runId,
          stepId: nextState.activeStepId,
          toolCallId: toolCall.id ?? `${nextState.step}-${toolName}`,
          toolName,
          source: authorization.source,
          riskLevel,
          permissions,
          args,
        });

        await appendToolAuditLog({
          timestamp: new Date().toISOString(),
          tenantId: nextState.tenantId ?? undefined,
          sessionId: nextState.sessionId ?? undefined,
          toolName,
          toolCallId: toolCall.id,
          source: authorization.source,
          url: typeof args.url === "string" ? args.url : undefined,
          riskLevel,
          permissions,
          args,
          outcome: "interrupted",
          resultSummary: toolSummary,
          detail: message,
        });

        if (!nextState.runId || !nextState.sessionId) {
          throw new Error(
            "Cannot request tool confirmation without runId and sessionId."
          );
        }

        const toolCallId = toolCall.id ?? `${nextState.step}-${toolName}`;
        const pendingApproval = await appendInterruptEvent({
          runId: nextState.runId,
          tenantId: nextState.tenantId,
          stepId,
          sessionId: nextState.sessionId,
          kind: "tool_confirmation",
          status: "pending",
          message,
          payload: buildApprovalPayload({
            toolName,
            toolCallId,
            args,
            toolSummary,
            riskLevel,
            permissions,
          }),
        });

        const decision = interrupt<
        {
          kind: "tool_confirmation"; // 定义中断请求的类型，包含工具调用ID、工具名称、参数和提示消息等信息
          approvalId: string;
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
          message: string;
          toolSummary?: string;
          toolRiskLevel?: "safe" | "confirm_required" | "dangerous";
          toolPermissions?: Array<"read" | "write" | "delete" | "execute">;
        },
        ToolConfirmationResume // 定义中断恢复时的类型，包含用户是否批准执行工具以及拒绝的原因等信息
        >({
          kind: "tool_confirmation", // 中断请求的类型
          approvalId: pendingApproval.id,
          toolCallId,
          toolName,
          args,
          message,
          toolSummary,
          toolRiskLevel: riskLevel,
          toolPermissions: permissions,
        });

        if (!decision?.approved) { // 如果用户拒绝执行工具，记录一个工具错误事件并继续下一个工具调用
          await appendToolAuditLog({
            timestamp: new Date().toISOString(),
            tenantId: nextState.tenantId ?? undefined,
            sessionId: nextState.sessionId ?? undefined,
            toolName,
            toolCallId: toolCall.id,
            source: authorization.source,
            url: typeof args.url === "string" ? args.url : undefined,
            riskLevel,
            permissions,
            args,
            outcome: "denied",
            resultSummary: toolSummary,
            detail:
              decision?.reason ?? `User denied tool execution: ${toolName}`,
          });
          await updateToolCallOutcome({
            sessionId: nextState.sessionId,
            tenantId: nextState.tenantId,
            toolCallId: toolCall.id ?? `${nextState.step}-${toolName}`,
            status: "denied",
            resultSummary:
              decision?.reason ?? `User denied tool execution: ${toolName}`,
            errorMessage:
              decision?.reason ?? `User denied tool execution: ${toolName}`,
            approvedByUser: false,
          });
          appendToolError(
            nextState,
            toolCall,
            toolName,
            decision?.reason ?? `User denied tool execution: ${toolName}`
          );
          continue;
        }

        await upsertToolCallStart({
          sessionId: nextState.sessionId,
          tenantId: nextState.tenantId,
          runId: nextState.runId,
          stepId: nextState.activeStepId,
          toolCallId: toolCall.id ?? `${nextState.step}-${toolName}`,
          toolName,
          source: authorization.source,
          riskLevel,
          permissions,
          args,
          approvedByUser: true,
        });
      }

      await executeSingleToolCall(nextState, toolCall, args, {
        approvalGranted:
          authorization.decision.action === "require_approval",
      }); // 执行工具调用，传入当前状态、工具调用对象和解析后的参数
    }
    if (stepId) {
      await completeAgentStep({
        stepId,
        tenantId: requireStateTenantId(nextState),
        sessionId: nextState.sessionId,
        runId: nextState.runId,
        output: {
          toolCallCount: nextState.toolCalls.length,
          completionReason: nextState.completionReason,
        },
      });
    }
    nextState.activeStepId = null;
  } catch (error) {
    nextState.activeStepId = null;
    if (stepId) {
      await completeAgentStep({
        stepId,
        tenantId: requireStateTenantId(nextState),
        sessionId: nextState.sessionId,
        runId: nextState.runId,
        status: "error",
        output: {
          completionReason: "error",
        },
      });
    }
    if (nextState.runId) {
      await appendErrorLog({
        runId: nextState.runId,
        tenantId: nextState.tenantId,
        stepId,
        sessionId: nextState.sessionId,
        source: "executeToolsNode",
        error,
        context: {
          step: nextState.step,
        },
      });
    }
    throw error;
  }

  return {
    ...nextState,
    events: nextState.events,
  };
}

function routeAfterModel(state: GraphAgentState) {
  const nextState = shouldContinue(cloneAgentState(state));
  return nextState.currentNode === "tools" ? "executeToolsNode" : END;
}

function routeAfterTools(state: GraphAgentState) {
  const nextState = shouldContinue(cloneAgentState(state));
  return nextState.currentNode === "model" ? "callModelNode" : END;
}

export function createRuntimeStateGraph() { // 创建一个运行时状态图，定义了节点和边的逻辑
  return new StateGraph(AgentGraphState)
    .addNode("callModelNode", runModelDraft) // 添加调用模型节点
    .addNode("executeToolsNode", runToolsDraft) // 添加执行工具节点
    .addEdge(START, "callModelNode") // 定义开始节点到调用模型节点的边
    .addConditionalEdges("callModelNode", routeAfterModel, { // 定义调用模型节点之后的条件边，根据路由函数决定下一步执行哪个节点
      executeToolsNode: "executeToolsNode",
      [END]: END,
    })
    .addConditionalEdges("executeToolsNode", routeAfterTools, { // 定义执行工具节点之后的条件边，根据路由函数决定下一步执行哪个节点
      callModelNode: "callModelNode",
      [END]: END,
    })
    .compile({
      checkpointer: memorySaver,
    });// 编译状态图，准备执行
}

export const runtimeStateGraph = createRuntimeStateGraph();

export type RuntimeGraphState = GraphAgentState;

export async function invokeRuntimeStateGraph(
  messages: ProviderMessage[],
  threadId = "draft-thread"
) { // 调用运行时状态图的函数，接受消息作为输入，创建状态图并执行
  return runtimeStateGraph.invoke(
    createAgentState(structuredClone(messages), undefined, threadId),
    {
    configurable: {
      thread_id: threadId,
    },
    }
  );
}

export async function getRuntimeThreadState(threadId: string) {
  return runtimeStateGraph.getState({
    configurable: {
      thread_id: threadId,
    },
  });
}

export async function persistRuntimeThreadState(
  threadId: string,
  options: { tenantId: string }
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to persist thread state");
  }

  const snapshot = await getRuntimeThreadState(threadId);
  const values =
    snapshot.values && typeof snapshot.values === "object"
      ? snapshot.values
      : null;

  if (!values) {
    return null;
  }

  await upsertTenantCheckpoint({
    tenantId: options.tenantId,
    sessionId: threadId,
    threadId,
    payload: values,
  });

  return values;
}

export async function getPersistedRuntimeThreadState(
  threadId: string,
  options: { tenantId: string }
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to read persisted thread state");
  }

  return getTenantCheckpoint({
    tenantId: options.tenantId,
    sessionId: threadId,
    threadId,
  });
}
