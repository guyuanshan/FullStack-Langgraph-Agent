import type { ProviderMessage } from "../ai/providers/types";
import type { StreamEvent } from "../../types/chat";

export type AgentRole =
  | "planner"
  | "code"
  | "browser"
  | "reviewer"
  | "tool_executor"
  | "finalizer";

export type AgentTaskKind =
  | "architecture_analysis"
  | "bug_fix"
  | "documentation_research"
  | "code_change"
  | "project_search"
  | "pr_summary"
  | "general";

export type PlanStepStatus = "pending" | "completed" | "failed" | "skipped";

export type MultiAgentCompletionReason =
  | "completed"
  | "plan_rejected"
  | "review_rejected"
  | "error"
  | null;

export type PlannerOutput = {
  goal: string;
  complexity: "low" | "medium" | "high";
  primaryAgent: Extract<AgentRole, "code" | "browser" | "tool_executor">;
  requiresPlanApproval: boolean;
  steps: Array<{
    id: string;
    title: string;
    agent: Extract<AgentRole, "code" | "browser" | "tool_executor" | "reviewer">;
    objective: string;
  }>;
};

export type ReviewerOutput = {
  approved: boolean;
  feedback: string;
  finalAnswer?: string;
};

export type SubtaskResult = {
  id: string;
  agent: Extract<AgentRole, "code" | "browser" | "tool_executor">;
  title: string;
  objective: string;
  result: string;
  toolCount: number;
};

export type AgentObservation = {
  id: string;
  agent: AgentRole;
  phase: "started" | "completed" | "handoff" | "error";
  message: string;
  latencyMs?: number;
  toolCount?: number;
  createdAt: string;
};

export type MultiAgentState = {
  runId: string | null;
  activeStepId: string | null;
  sessionId: string | null;
  messages: ProviderMessage[];
  events: StreamEvent[];
  latestUserTask: string;
  taskKind: AgentTaskKind;
  plan: PlannerOutput | null;
  activeAgent: AgentRole | null;
  observations: AgentObservation[];
  traceGroupId: string;
  subtaskResults: SubtaskResult[];
  executorResult: string;
  reviewerResult: ReviewerOutput | null;
  reviewerFeedback: string;
  revisionCount: number;
  maxRevisionCount: number;
  requirePlanApproval: boolean;
  planApproved: boolean | null;
  finalAnswer: string;
  completionReason: MultiAgentCompletionReason;
};
