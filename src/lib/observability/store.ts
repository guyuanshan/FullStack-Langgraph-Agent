import { prisma } from "../db/client";

export type RuntimeType = "manual" | "langgraph" | "multi_agent";
export type RunTrigger = "request" | "resume";
export type RunStatus = "running" | "completed" | "interrupted" | "error";
export type StepStatus = "started" | "completed" | "interrupted" | "error";
export type StepType =
  | "workflow"
  | "agent_node"
  | "tool_node"
  | "model_node"
  | "interrupt"
  | "route";

export function estimateTokenCount(value: unknown) {
  if (value === undefined || value === null) {
    return 0;
  }

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateModelCostUsd(options: {
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
}) {
  const promptTokens = options.promptTokens ?? 0;
  const completionTokens = options.completionTokens ?? 0;
  const reasoningTokens = options.reasoningTokens ?? 0;

  const estimatedUsd =
    promptTokens * 0.00000015 +
    completionTokens * 0.0000006 +
    reasoningTokens * 0.0000003;

  return Number(estimatedUsd.toFixed(8));
}

function summarizeValue(value: unknown, maxLength = 1200) {
  if (value === undefined || value === null) {
    return null;
  }

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…`;
}

export async function createAgentRun(options: {
  runId: string;
  sessionId?: string | null;
  runtimeType: RuntimeType;
  trigger: RunTrigger;
  entrypoint?: string;
  latestUserTask?: string | null;
}) {
  await prisma.agentRun.create({
    data: {
      id: options.runId,
      sessionId: options.sessionId ?? null,
      runtimeType: options.runtimeType,
      trigger: options.trigger,
      status: "running",
      entrypoint: options.entrypoint ?? null,
      latestUserTask: options.latestUserTask ?? null,
    },
  });
}

export async function completeAgentRun(options: {
  runId: string;
  status?: Exclude<RunStatus, "running">;
  completionReason?: string | null;
  errorMessage?: string | null;
}) {
  const existing = await prisma.agentRun.findUnique({
    where: { id: options.runId },
    select: { startedAt: true },
  });
  const finishedAt = new Date();

  await prisma.agentRun.update({
    where: {
      id: options.runId,
    },
    data: {
      status: options.status ?? "completed",
      completionReason: options.completionReason ?? null,
      errorMessage: options.errorMessage ?? null,
      finishedAt,
      latencyMs: existing?.startedAt
        ? finishedAt.getTime() - existing.startedAt.getTime()
        : null,
    },
  });
}

export async function createAgentStep(options: {
  runId: string;
  sessionId?: string | null;
  agentName?: string | null;
  nodeName: string;
  stepType: StepType;
  status?: StepStatus;
  input?: unknown;
}) {
  const step = await prisma.agentStep.create({
    data: {
      runId: options.runId,
      sessionId: options.sessionId ?? null,
      agentName: options.agentName ?? null,
      nodeName: options.nodeName,
      stepType: options.stepType,
      status: options.status ?? "started",
      inputSummary: summarizeValue(options.input),
    },
    select: {
      id: true,
    },
  });

  return step.id;
}

export async function completeAgentStep(options: {
  stepId: string;
  status?: Exclude<StepStatus, "started">;
  output?: unknown;
}) {
  const existing = await prisma.agentStep.findUnique({
    where: { id: options.stepId },
    select: { startedAt: true },
  });
  const finishedAt = new Date();

  await prisma.agentStep.update({
    where: { id: options.stepId },
    data: {
      status: options.status ?? "completed",
      outputSummary: summarizeValue(options.output),
      finishedAt,
      latencyMs: existing?.startedAt
        ? finishedAt.getTime() - existing.startedAt.getTime()
        : null,
    },
  });
}

export async function appendInterruptEvent(options: {
  runId: string;
  stepId?: string | null;
  sessionId?: string | null;
  kind: string;
  status: "pending" | "approved" | "rejected";
  message?: string | null;
  payload?: unknown;
  reason?: string | null;
}) {
  await prisma.interruptEvent.create({
    data: {
      runId: options.runId,
      stepId: options.stepId ?? null,
      sessionId: options.sessionId ?? null,
      kind: options.kind,
      status: options.status,
      message: options.message ?? null,
      payloadJson: summarizeValue(options.payload, 4000),
      reason: options.reason ?? null,
    },
  });
}

export async function appendErrorLog(options: {
  runId?: string | null;
  stepId?: string | null;
  sessionId?: string | null;
  source: string;
  error: unknown;
  context?: unknown;
}) {
  const message =
    options.error instanceof Error
      ? options.error.message
      : typeof options.error === "string"
        ? options.error
        : "Unknown error";
  const stack =
    options.error instanceof Error ? options.error.stack ?? null : null;

  await prisma.errorLog.create({
    data: {
      runId: options.runId ?? null,
      stepId: options.stepId ?? null,
      sessionId: options.sessionId ?? null,
      source: options.source,
      message,
      stack,
      contextJson: summarizeValue(options.context, 4000),
    },
  });
}

export async function appendModelCall(options: {
  runId: string;
  stepId?: string | null;
  sessionId?: string | null;
  agentName?: string | null;
  nodeName?: string | null;
  provider: string;
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  latencyMs?: number | null;
  status: "success" | "error";
  input?: unknown;
  output?: unknown;
  errorMessage?: string | null;
}) {
  await prisma.modelCall.create({
    data: {
      runId: options.runId,
      stepId: options.stepId ?? null,
      sessionId: options.sessionId ?? null,
      agentName: options.agentName ?? null,
      nodeName: options.nodeName ?? null,
      provider: options.provider,
      model: options.model,
      promptTokens: options.promptTokens ?? null,
      completionTokens: options.completionTokens ?? null,
      reasoningTokens: options.reasoningTokens ?? null,
      estimatedCostUsd: estimateModelCostUsd({
        promptTokens: options.promptTokens,
        completionTokens: options.completionTokens,
        reasoningTokens: options.reasoningTokens,
      }),
      latencyMs: options.latencyMs ?? null,
      status: options.status,
      inputSummary: summarizeValue(options.input),
      outputSummary: summarizeValue(options.output),
      errorMessage: options.errorMessage ?? null,
      finishedAt: new Date(),
    },
  });
}
