import { getDefaultChatProvider } from "../../lib/ai/providers";
import type {
  ProviderToolCall,
  ProviderToolCallDelta,
} from "../../lib/ai/providers/types";
import { appendToolAuditLog } from "../../lib/audit/log";
import { executeTool, getProviderTools, getTool } from "../../lib/tools";
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
  return JSON.parse(
    toolCall.function.arguments || "{}"
  ) as Record<string, unknown>;
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
  const name = toolCall.function.name;
  const tool = await getTool(name);
  const toolSummary = summarizeToolArgs(args);
  const toolRiskLevel = resolveToolRiskLevel(tool, args);
  const toolPermissions = resolveToolPermissions(tool);
  const executionArgs =
    (name.startsWith("browser_") || name === "code_propose_patch") &&
    state.sessionId
      ? {
          ...args,
          ...(name.startsWith("browser_")
            ? { browserSessionId: state.sessionId }
            : {}),
          ...(name === "code_propose_patch"
            ? { agentSessionId: state.sessionId }
            : {}),
        }
      : args;

  console.log(`[agent step ${state.step}] tool name:`, name);
  console.log(`[agent step ${state.step}] tool args:`, args);

  state.events.push({
    type: "tool_start",
    toolName: name,
    toolCallId: toolCall.id,
    args,
    toolSummary,
    toolRiskLevel,
    toolPermissions,
  });

  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
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
      toolName: name,
      toolCallId: toolCall.id,
      source: tool?.source,
      url: getResultUrl(execution.result) ?? (typeof args.url === "string" ? args.url : undefined),
      riskLevel: toolRiskLevel,
      permissions: toolPermissions,
      args,
      outcome: "success",
      resultSummary: summarizeToolResult(execution.result),
      detail: JSON.stringify(execution.result),
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
    toolName: name,
    toolCallId: toolCall.id,
    source: tool?.source,
    url: typeof args.url === "string" ? args.url : undefined,
    riskLevel: toolRiskLevel,
    permissions: toolPermissions,
    args,
    outcome: "error",
    resultSummary: message,
    detail: message,
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

  resetStepState(state);
  state.step += 1;
  markNode(state, "model");
  const providerTools = await getProviderTools();

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
