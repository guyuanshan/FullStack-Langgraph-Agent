import type { ProviderMessage, ProviderToolCall } from "../ai/providers/types";
import type { StreamEvent } from "../../types/chat";

export const DEFAULT_MAX_STEPS = 5;

export type AgentNodeName = "model" | "tools" | "done";

export type AgentExecutableNode = Exclude<AgentNodeName, "done">;

export type AgentCompletionReason = "completed" | "max_steps" | "error" | null;

export type AgentState = { // 代理状态类型定义
  runId: string | null;
  activeStepId: string | null;
  sessionId: string | null; // 当前会话 ID，用于为工具注入会话级上下文
  messages: ProviderMessage[]; // 代理对话消息列表
  step: number; // 当前步骤数
  maxSteps: number; // 最大步骤数限制
  toolCalls: ProviderToolCall[];// 工具调用记录列表
  assistantContent: string; // 助手生成的内容
  reasoningContent: string; // 助手的推理过程内容
  events: StreamEvent[]; // 代理执行过程中产生的事件列表
  assistantMessage: ProviderMessage | null; // 当前助手消息对象
  currentNode: AgentNodeName; // 当前条件流转要执行的节点
  lastNode: AgentExecutableNode | null; // 最近一次执行完成的节点
  completionReason: AgentCompletionReason; // 运行结束原因
};

export function createAgentState( // 创建初始代理状态
  messages: ProviderMessage[],
  maxSteps = DEFAULT_MAX_STEPS,
  sessionId: string | null = null,
  runId: string | null = null
): AgentState {
  return {
    runId,
    activeStepId: null,
    sessionId,
    messages,
    step: 0,
    maxSteps,
    toolCalls: [],
    assistantContent: "",
    reasoningContent: "",
    events: [],
    assistantMessage: null,
    currentNode: "model",
    lastNode: null,
    completionReason: null,
  };
}

export function resetStepState(state: AgentState) { // 重置当前步骤的状态，准备进入下一步骤
  state.toolCalls = [];
  state.assistantContent = "";
  state.reasoningContent = "";
  state.events = [];
  state.assistantMessage = null;
}
