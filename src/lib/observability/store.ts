import { prisma } from "../db/client";
import { assertTenantConsistency, resolveWriteTenantId } from "../db/tenant";

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
  tenantId?: string | null;
  sessionId?: string | null;
  runtimeType: RuntimeType;
  trigger: RunTrigger;
  entrypoint?: string;
  latestUserTask?: string | null;
}) {
  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
  });

  await assertTenantConsistency({
    tenantId,
    sessionId: options.sessionId,
  });

  await prisma.agentRun.create({
    data: {
      id: options.runId,
      tenantId,
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
  tenantId: string;
  sessionId?: string | null;
  status?: Exclude<RunStatus, "running">;
  completionReason?: string | null;
  errorMessage?: string | null;
}) {
  if (!options.tenantId.trim()) {
    throw new Error("tenantId is required to complete an agent run");
  }

  const existing = await prisma.agentRun.findFirst({
    where: {
      id: options.runId,
      tenantId: options.tenantId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
    select: { startedAt: true },
  });

  if (!existing) {
    throw new Error(
      `AgentRun ${options.runId} not found for tenant ${options.tenantId}`
    );
  }

  const finishedAt = new Date();

  await prisma.agentRun.updateMany({
    where: {
      id: options.runId,
      tenantId: options.tenantId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
    data: {
      status: options.status ?? "completed",
      completionReason: options.completionReason ?? null,
      errorMessage: options.errorMessage ?? null,
      finishedAt,
      latencyMs: existing.startedAt
        ? finishedAt.getTime() - existing.startedAt.getTime()
        : null,
    },
  });
}

export async function createAgentStep(options: {
  runId: string;
  tenantId?: string | null;
  sessionId?: string | null;
  agentName?: string | null;
  nodeName: string;
  stepType: StepType;
  status?: StepStatus;
  input?: unknown;
}) {
  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    runId: options.runId,
  });

  await assertTenantConsistency({
    tenantId,
    sessionId: options.sessionId,
    runId: options.runId,
  });

  const step = await prisma.agentStep.create({
    data: {
      tenantId,
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
  tenantId: string;
  sessionId?: string | null;
  runId?: string | null;
  status?: Exclude<StepStatus, "started">;
  output?: unknown;
}) {
  if (!options.tenantId.trim()) {
    throw new Error("tenantId is required to complete an agent step");
  }

  const existing = await prisma.agentStep.findFirst({
    where: {
      id: options.stepId,
      tenantId: options.tenantId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
    },
    select: { startedAt: true },
  });

  if (!existing) {
    throw new Error(
      `AgentStep ${options.stepId} not found for tenant ${options.tenantId}`
    );
  }

  const finishedAt = new Date();

  await prisma.agentStep.updateMany({
    where: {
      id: options.stepId,
      tenantId: options.tenantId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
    },
    data: {
      status: options.status ?? "completed",
      outputSummary: summarizeValue(options.output),
      finishedAt,
      latencyMs: existing.startedAt
        ? finishedAt.getTime() - existing.startedAt.getTime()
        : null,
    },
  });
}

export async function appendInterruptEvent(options: {
  runId: string;
  tenantId?: string | null;
  stepId?: string | null;
  sessionId?: string | null;
  kind: string;
  status: "pending" | "approved" | "rejected" | "expired";
  message?: string | null;
  payload?: unknown;
  reason?: string | null;
}) {
  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    runId: options.runId,
    stepId: options.stepId,
  });

  return prisma.interruptEvent.create({
    data: {
      tenantId,
      runId: options.runId,
      stepId: options.stepId ?? null,
      sessionId: options.sessionId ?? null,
      kind: options.kind,
      status: options.status,
      message: options.message ?? null,
      payloadJson: summarizeValue(options.payload, 4000),
      reason: options.reason ?? null,
    },
    select: {
      id: true,
      tenantId: true,
      sessionId: true,
      runId: true,
      kind: true,
      status: true,
    },
  });
}

export async function appendErrorLog(options: {
  runId?: string | null;
  tenantId?: string | null;
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
  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    runId: options.runId,
    stepId: options.stepId,
  });

  await prisma.errorLog.create({
    data: {
      tenantId,
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
  tenantId?: string | null;
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
  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    runId: options.runId,
    stepId: options.stepId,
  });

  await prisma.modelCall.create({
    data: {
      tenantId,
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
