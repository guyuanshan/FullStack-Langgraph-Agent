import { Annotation } from "@langchain/langgraph";
import { EphemeralValue } from "@langchain/langgraph/channels";
import type { ProviderMessage, ProviderToolCall } from "../ai/providers/types";
import type { StreamEvent } from "../../types/chat";
import type {
  AgentCompletionReason,
  AgentExecutableNode,
  AgentNodeName,
} from "../agent/state";

function replaceValue<Value>(defaultValue: () => Value) { // 创建一个替换值的函数，接受一个返回默认值的函数作为参数
  return Annotation<Value>({
    reducer: (_current, update) => update,
    default: defaultValue,
  });
}

export const AgentGraphState = Annotation.Root({ // 定义一个AgentGraphState的根注解，包含了代理状态的各种属性
  messages: replaceValue<ProviderMessage[]>(() => []),
  step: replaceValue<number>(() => 0),
  maxSteps: replaceValue<number>(() => 5),
  toolCalls: replaceValue<ProviderToolCall[]>(() => []),
  assistantContent: replaceValue<string>(() => ""),
  reasoningContent: replaceValue<string>(() => ""),
  events: () => new EphemeralValue<StreamEvent[]>(),
  assistantMessage: replaceValue<ProviderMessage | null>(() => null),
  currentNode: replaceValue<AgentNodeName>(() => "model"),
  lastNode: replaceValue<AgentExecutableNode | null>(() => null),
  completionReason: replaceValue<AgentCompletionReason>(() => null),
});

export type GraphAgentState = typeof AgentGraphState.State;
