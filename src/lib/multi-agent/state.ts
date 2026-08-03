import { Annotation } from "@langchain/langgraph";
import { EphemeralValue } from "@langchain/langgraph/channels";
import type { ProviderMessage } from "../ai/providers/types";
import type { StreamEvent } from "../../types/chat";
import type {
  AgentObservation,
  AgentTaskKind,
  MultiAgentCompletionReason,
  MultiAgentState,
  PlannerOutput,
  ReviewerOutput,
  AgentRole,
  SubtaskResult,
} from "./types";
import { classifyTaskKind } from "./router";
import type { AuthContext } from "../auth/tenant-resolution";

function replaceValue<Value>(defaultValue: () => Value) {
  return Annotation<Value>({
    reducer: (_current, update) => update,
    default: defaultValue,
  });
}

export const MultiAgentGraphState = Annotation.Root({
  auth: replaceValue<AuthContext | null>(() => null),
  runId: replaceValue<string | null>(() => null),
  activeStepId: replaceValue<string | null>(() => null),
  tenantId: replaceValue<string | null>(() => null),
  sessionId: replaceValue<string | null>(() => null),
  messages: replaceValue<ProviderMessage[]>(() => []),
  events: () => new EphemeralValue<StreamEvent[]>(),
  latestUserTask: replaceValue<string>(() => ""),
  taskKind: replaceValue<AgentTaskKind>(() => "general"),
  plan: replaceValue<PlannerOutput | null>(() => null),
  activeAgent: replaceValue<AgentRole | null>(() => null),
  observations: replaceValue<AgentObservation[]>(() => []),
  traceGroupId: replaceValue<string>(() => ""),
  subtaskResults: replaceValue<SubtaskResult[]>(() => []),
  executorResult: replaceValue<string>(() => ""),
  reviewerResult: replaceValue<ReviewerOutput | null>(() => null),
  reviewerFeedback: replaceValue<string>(() => ""),
  revisionCount: replaceValue<number>(() => 0),
  maxRevisionCount: replaceValue<number>(() => 1),
  requirePlanApproval: replaceValue<boolean>(() => false),
  planApproved: replaceValue<boolean | null>(() => null),
  finalAnswer: replaceValue<string>(() => ""),
  completionReason: replaceValue<MultiAgentCompletionReason>(() => null),
});

export function createMultiAgentState(
  messages: ProviderMessage[],
  sessionId: string | null,
  requirePlanApproval = false,
  runId: string | null = null,
  tenantId: string | null = null,
  auth: AuthContext | null = null
): MultiAgentState {
  const latestUserTask = [...messages]
    .reverse()
    .find((message) => message?.role === "user" && typeof message.content === "string")
    ?.content as string | undefined;

  return {
    auth,
    runId,
    activeStepId: null,
    tenantId,
    sessionId,
    messages,
    events: [],
    latestUserTask: latestUserTask ?? "",
    taskKind: classifyTaskKind(latestUserTask ?? ""),
    plan: null,
    activeAgent: null,
    observations: [],
    traceGroupId: crypto.randomUUID(),
    subtaskResults: [],
    executorResult: "",
    reviewerResult: null,
    reviewerFeedback: "",
    revisionCount: 0,
    maxRevisionCount: 1,
    requirePlanApproval,
    planApproved: null,
    finalAnswer: "",
    completionReason: null,
  };
}

export type RuntimeMultiAgentState = typeof MultiAgentGraphState.State;
