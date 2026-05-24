import type {
  AgentRole,
  PlannerOutput,
  ReviewerOutput,
  SubtaskResult,
} from "./types";

export const MULTI_AGENT_SYSTEM_PROMPT = [
  "You are part of a coordinated multi-agent system.",
  "Work with strong task boundaries, concise outputs, and explicit handoffs.",
  "Use tools only when they materially improve accuracy or execution.",
].join(" ");

export function createPlannerPrompt(task: string) {
  return [
    MULTI_AGENT_SYSTEM_PROMPT,
    "You are the Planner Agent.",
    "Return strict JSON only with keys: goal, complexity, primaryAgent, requiresPlanApproval, steps.",
    "primaryAgent must be one of: code, browser, tool_executor.",
    "steps must be an array of objects with keys: id, title, agent, objective.",
    "Keep the plan compact and execution-oriented.",
    `User task: ${task}`,
  ].join("\n\n");
}

export function createExecutorPrompt(
  role: Extract<AgentRole, "code" | "browser" | "tool_executor">,
  plan: PlannerOutput,
  reviewerFeedback: string
) {
  const roleInstruction =
    role === "browser"
      ? "You are the Browser Agent. Focus on documentation lookup, page reading, link extraction, and web-grounded answers."
      : role === "tool_executor"
        ? "You are the Tool Executor Agent. Focus on precise tool use and compact execution results."
        : "You are the Code Agent. Focus on code understanding, patches, tests, project memory, and repository-aware execution.";

  return [
    MULTI_AGENT_SYSTEM_PROMPT,
    roleInstruction,
    "Respect the planner's goal and steps.",
    "If tools are available and useful, call them. If not, answer directly.",
    "Keep the final answer compact and factual.",
    `Plan goal: ${plan.goal}`,
    `Plan steps:\n${plan.steps
      .map((step) => `- [${step.agent}] ${step.title}: ${step.objective}`)
      .join("\n")}`,
    reviewerFeedback.trim()
      ? `Reviewer feedback from previous pass:\n${reviewerFeedback}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function createSubtaskPrompt(
  role: Extract<AgentRole, "code" | "browser" | "tool_executor">,
  step: { title: string; objective: string },
  plan: PlannerOutput
) {
  const roleInstruction =
    role === "browser"
      ? "You are a Browser Agent subtask worker."
      : role === "tool_executor"
        ? "You are a Tool Executor subtask worker."
        : "You are a Code Agent subtask worker.";

  return [
    MULTI_AGENT_SYSTEM_PROMPT,
    roleInstruction,
    "Focus only on the assigned subtask.",
    "Use tools when helpful. Produce a compact factual result for this subtask only.",
    `Overall goal: ${plan.goal}`,
    `Subtask title: ${step.title}`,
    `Subtask objective: ${step.objective}`,
  ].join("\n\n");
}

export function createSynthesisPrompt(
  plan: PlannerOutput,
  results: SubtaskResult[],
  reviewerFeedback: string
) {
  return [
    MULTI_AGENT_SYSTEM_PROMPT,
    "You are the synthesis step for a multi-agent workflow.",
    "Combine the subtask findings into one direct, user-facing answer.",
    "Preserve concrete technical details, avoid repetition, and do not mention internal workflow unless useful.",
    `Goal: ${plan.goal}`,
    reviewerFeedback.trim()
      ? `Reviewer feedback to address:\n${reviewerFeedback}`
      : "",
    `Subtask findings:\n${results
      .map(
        (result) =>
          `- [${result.agent}] ${result.title}: ${result.result || "No result"}`
      )
      .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function createReviewerPrompt(plan: PlannerOutput, executorResult: string) {
  return [
    MULTI_AGENT_SYSTEM_PROMPT,
    "You are the Reviewer Agent.",
    "Review the executor result for correctness, missing validation, risky assumptions, and regressions.",
    "Return strict JSON only with keys: approved, feedback, finalAnswer.",
    "If the result is acceptable, approved must be true and finalAnswer should be the user-facing answer.",
    "If the result is not acceptable, approved must be false and feedback should say what must be improved.",
    `Plan goal: ${plan.goal}`,
    `Executor result:\n${executorResult}`,
  ].join("\n\n");
}

export function createFinalizerPrompt(options: {
  goal: string;
  latestUserTask: string;
  executorResult: string;
  reviewerAnswer?: string;
  reviewerFeedback?: string;
}) {
  return [
    MULTI_AGENT_SYSTEM_PROMPT,
    "You are the Finalizer Agent.",
    "Produce the final user-facing answer only.",
    "Write in the same language as the user request.",
    "Be concise, direct, and natural.",
    "Do not mention internal planner, reviewer, or workflow details.",
    `User goal: ${options.goal}`,
    `Latest user task: ${options.latestUserTask}`,
    options.reviewerFeedback?.trim()
      ? `Reviewer feedback to satisfy:\n${options.reviewerFeedback}`
      : "",
    options.reviewerAnswer?.trim()
      ? `Preferred answer draft:\n${options.reviewerAnswer}`
      : "",
    `Execution findings:\n${options.executorResult}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function createPlanSummary(plan: PlannerOutput) {
  return [
    `Goal: ${plan.goal}`,
    `Complexity: ${plan.complexity}`,
    `Primary agent: ${plan.primaryAgent}`,
    "Steps:",
    ...plan.steps.map(
      (step) => `- [${step.agent}] ${step.title}: ${step.objective}`
    ),
  ].join("\n");
}

export function isPlannerOutput(value: unknown): value is PlannerOutput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.goal === "string" &&
    typeof candidate.complexity === "string" &&
    typeof candidate.primaryAgent === "string" &&
    typeof candidate.requiresPlanApproval === "boolean" &&
    Array.isArray(candidate.steps)
  );
}

export function isReviewerOutput(value: unknown): value is ReviewerOutput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.approved === "boolean" &&
    typeof candidate.feedback === "string"
  );
}
