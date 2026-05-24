import { getDefaultChatProvider } from "../../lib/ai/providers";
import type {
  ProviderToolCall,
  ProviderToolCallDelta,
} from "../../lib/ai/providers/types";
import { appendToolAuditLog } from "../../lib/audit/log";
import { ensureSession } from "../../lib/chat";
import {
  appendModelCall,
  estimateTokenCount,
} from "../../lib/observability/store";
import { executeTool, getProviderTools, getTool } from "../../lib/tools";
import {
  updateToolCallOutcome,
  upsertToolCallStart,
} from "../../lib/tools/tool-call-store";
import {
  resolveToolPermissions,
  resolveToolRiskLevel,
} from "../../lib/tools/policy";
import { encodeSSE } from "../../lib/stream/sse";
import {
  getResultUrl,
  summarizeToolArgs,
  summarizeToolResult,
} from "../../lib/tools/summary";
import {
  resetStepState,
  type AgentState,
  type AgentExecutableNode,
} from "./state";

function createEmptyToolCall(id?: string): ProviderToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "",
      arguments: "",
    },
  };
}

export function collectToolCall(
  toolCalls: ProviderToolCall[],
  toolCallDelta: ProviderToolCallDelta
) {
  const index = toolCallDelta.index ?? 0;

  if (!toolCalls[index]) {
    toolCalls[index] = createEmptyToolCall(toolCallDelta.id);
  }

  if (toolCallDelta.id) {
    toolCalls[index].id = toolCallDelta.id;
  }

  if (toolCallDelta.function?.name) {
    toolCalls[index].function.name += toolCallDelta.function.name;
  }

  if (toolCallDelta.function?.arguments) {
    toolCalls[index].function.arguments += toolCallDelta.function.arguments;
  }
}

function extractAssistantState(state: AgentState) {
  if (!state.assistantMessage) {
    state.assistantContent = "";
    state.reasoningContent = "";
    return;
  }

  const content = state.assistantMessage.content;
  const reasoningContent = state.assistantMessage.reasoning_content;

  state.assistantContent = typeof content === "string" ? content : "";
  state.reasoningContent =
    typeof reasoningContent === "string" ? reasoningContent : "";
}

function markNode(state: AgentState, node: AgentExecutableNode) { // 标记当前执行的节点
  state.lastNode = node;
}

export function parseToolCallArgs(toolCall: ProviderToolCall) {
  const rawArguments = toolCall.function.arguments || "{}";

  const tryParse = (value: string) => {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  };

  try {
    return tryParse(rawArguments);
  } catch {
    const repairedArguments = rawArguments
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/,\s*([}\]])/g, "$1");

    try {
      return tryParse(repairedArguments);
    } catch (error) {
      console.error("Failed to parse tool call arguments", {
        toolName: toolCall.function.name,
        rawArguments,
        repairedArguments,
        error,
      });
      return {};
    }
  }
}

export function hasToolMessage(
  state: AgentState,
  toolCallId: string | undefined
) {
  if (!toolCallId) {
    return false;
  }

  return state.messages.some(
    (message) =>
      message?.role === "tool" && message?.tool_call_id === toolCallId
  );
}

export function appendToolSuccess(
  state: AgentState,
  toolCall: ProviderToolCall,
  toolName: string,
  result: unknown
) {
  state.events.push({
    type: "tool_result",
    toolName,
    toolCallId: toolCall.id,
    result,
  });

  state.messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  });
}

export function appendToolError(
  state: AgentState,
  toolCall: ProviderToolCall,
  toolName: string,
  message: string
) {
  state.events.push({
    type: "tool_error",
    toolName,
    toolCallId: toolCall.id,
    message,
  });

  state.messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify({
      error: message,
      toolName,
    }),
  });
}

export async function executeSingleToolCall(
  state: AgentState,
  toolCall: ProviderToolCall,
  args = parseToolCallArgs(toolCall)
) {
  const startedAt = Date.now();
  const name = toolCall.function.name;
  const tool = await getTool(name);
  const toolSummary = summarizeToolArgs(args);
  const toolRiskLevel = resolveToolRiskLevel(tool, args);
  const toolPermissions = resolveToolPermissions(tool);
  const progressEnabled =
    name === "project_memory_index" || name === "project_memory_refresh";
  const executionArgs =
    (name.startsWith("browser_") ||
      name === "code_propose_patch" ||
      progressEnabled) &&
    state.sessionId
      ? {
          ...args,
          ...(name.startsWith("browser_")
            ? { browserSessionId: state.sessionId }
            : {}),
          ...(name === "code_propose_patch"
            ? { agentSessionId: state.sessionId }
            : {}),
          ...(progressEnabled
            ? {
                __progress: (progress: {
                  phase: "scanning" | "embedding";
                  completed: number;
                  total: number;
                  chunkKey?: string;
                  sourcePath?: string | null;
                }) => {
                  state.events.push({
                    type: "tool_progress",
                    toolName: name,
                    toolCallId: toolCall.id,
                    progress,
                  });
                },
              }
            : {}),
        }
      : args;

  console.log(`[agent step ${state.step}] tool name:`, name);
  console.log(`[agent step ${state.step}] tool args:`, args);

  if (state.sessionId) {
    await ensureSession(state.sessionId);
  }

  state.events.push({
    type: "tool_start",
    toolName: name,
    toolCallId: toolCall.id,
    args,
    toolSummary,
    toolRiskLevel,
    toolPermissions,
  });

  await upsertToolCallStart({
    sessionId: state.sessionId,
    runId: state.runId,
    stepId: state.activeStepId,
    toolCallId: toolCall.id ?? `${state.step}-${name}`,
    toolName: name,
    source: tool?.source,
    riskLevel: toolRiskLevel,
    permissions: toolPermissions,
    args,
  });
  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId ?? undefined,
    toolName: name,
    toolCallId: toolCall.id,
    source: tool?.source,
    url: typeof args.url === "string" ? args.url : undefined,
    riskLevel: toolRiskLevel,
    permissions: toolPermissions,
    args,
    outcome: "started",
  });

  const execution = await executeTool(name, executionArgs);

  if (execution.ok) {
    console.log(`[agent step ${state.step}] tool result:`, execution.result);
    appendToolSuccess(state, toolCall, name, execution.result);
    const lastEvent = state.events[state.events.length - 1];
    if (lastEvent?.type === "tool_result") {
      lastEvent.toolSummary = toolSummary;
    }
    await appendToolAuditLog({
      timestamp: new Date().toISOString(),
      sessionId: state.sessionId ?? undefined,
      toolName: name,
      toolCallId: toolCall.id,
      source: tool?.source,
      url: getResultUrl(execution.result) ?? (typeof args.url === "string" ? args.url : undefined),
      riskLevel: toolRiskLevel,
      permissions: toolPermissions,
      args,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      resultSummary: summarizeToolResult(execution.result),
      detail: JSON.stringify(execution.result),
    });
    await updateToolCallOutcome({
      sessionId: state.sessionId,
      toolCallId: toolCall.id ?? `${state.step}-${name}`,
      status: "success",
      resultSummary: summarizeToolResult(execution.result),
      result: execution.result,
      estimatedCostUsd: 0,
    });
    return;
  }

  const message = execution.error;
  appendToolError(state, toolCall, name, message);
  const lastEvent = state.events[state.events.length - 1];
  if (lastEvent?.type === "tool_error") {
    lastEvent.toolSummary = toolSummary;
  }
  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId ?? undefined,
    toolName: name,
    toolCallId: toolCall.id,
    source: tool?.source,
    url: typeof args.url === "string" ? args.url : undefined,
    riskLevel: toolRiskLevel,
    permissions: toolPermissions,
    args,
    outcome: "error",
    latencyMs: Date.now() - startedAt,
    resultSummary: message,
    detail: message,
  });
  await updateToolCallOutcome({
    sessionId: state.sessionId,
    toolCallId: toolCall.id ?? `${state.step}-${name}`,
    status: "error",
    resultSummary: message,
    errorMessage: message,
    estimatedCostUsd: 0,
  });
  console.log(`[agent step ${state.step}] tool error:`, message);
}

export function flushStateEvents(
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: AgentState
) {
  for (const event of state.events) {
    controller.enqueue(encodeSSE(event));
  }

  state.events = [];
}

export async function callModelNode(state: AgentState): Promise<AgentState> { // 调用模型节点的函数，处理与模型交互的逻辑
  const provider = getDefaultChatProvider();
  const startedAt = Date.now();
  const promptTokenEstimate = estimateTokenCount(state.messages);

  resetStepState(state);
  state.step += 1;
  markNode(state, "model");
  const providerTools = await getProviderTools();

  try {
    const chatStream = await provider.createChatStream(state.messages, {
      tools: [...providerTools],
    });

    for await (const event of chatStream.events) {
      if (event.type === "tool_call_delta") {
        collectToolCall(state.toolCalls, event.toolCall);
        continue;
      }

      state.assistantContent += event.text;
    }

    state.assistantMessage = chatStream.getAssistantMessage();
    extractAssistantState(state);

    if (state.runId) {
      await appendModelCall({
        runId: state.runId,
        stepId: state.activeStepId,
        sessionId: state.sessionId,
        agentName: "assistant",
        nodeName: "callModelNode",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        completionTokens: estimateTokenCount(state.assistantContent),
        reasoningTokens: estimateTokenCount(state.reasoningContent),
        latencyMs: Date.now() - startedAt,
        status: "success",
        input: {
          messageCount: state.messages.length,
          toolCount: providerTools.length,
        },
        output: {
          assistantContent: state.assistantContent,
          toolCallCount: state.toolCalls.length,
        },
      });
    }
  } catch (error) {
    if (state.runId) {
      await appendModelCall({
        runId: state.runId,
        stepId: state.activeStepId,
        sessionId: state.sessionId,
        agentName: "assistant",
        nodeName: "callModelNode",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        latencyMs: Date.now() - startedAt,
        status: "error",
        input: {
          messageCount: state.messages.length,
          toolCount: providerTools.length,
        },
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
    throw error;
  }

  if (state.toolCalls.length === 0) {
    if (state.assistantContent) {
      state.events.push({
        type: "text",
        content: state.assistantContent,
      });
    }

    if (state.assistantMessage) {
      state.messages.push(state.assistantMessage);
    }

    return state;
  }

  if (state.assistantMessage) {
    state.messages.push(state.assistantMessage);
  }

  return state;
}

export async function executeToolsNode(state: AgentState): Promise<AgentState> { // 执行工具节点的函数，处理工具调用的逻辑
  markNode(state, "tools");

  for (const toolCall of state.toolCalls) {
    await executeSingleToolCall(state, toolCall);
  }

  return state;
}

export function shouldContinue(state: AgentState): AgentState { // 判断是否继续推进的函数，根据当前状态决定下一步执行哪个节点，或者结束运行
  if (state.lastNode === "model") {
    if (state.toolCalls.length > 0) {
      state.currentNode = "tools";
      return state;
    }

    state.currentNode = "done";
    state.completionReason = "completed";
    return state;
  }

  if (state.lastNode === "tools") {
    if (state.step < state.maxSteps) {
      state.currentNode = "model";
      return state;
    }

    state.currentNode = "done";
    state.completionReason = "max_steps";
    return state;
  }

  state.currentNode = "done";
  state.completionReason = state.completionReason ?? "completed";
  return state;
}
