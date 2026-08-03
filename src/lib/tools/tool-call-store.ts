import { prisma } from "../db/client";
import { resolveWriteTenantId } from "../db/tenant";
import type { ToolPermission, ToolRiskLevel } from "./types";

function serializePermissions(permissions?: ToolPermission[]) {
  return permissions?.length ? permissions.join(",") : null;
}

export async function upsertToolCallStart(options: {
  sessionId: string | null;
  tenantId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  toolCallId: string;
  toolName: string;
  source?: "local" | "mcp";
  riskLevel?: ToolRiskLevel;
  permissions?: ToolPermission[];
  args?: Record<string, unknown>;
  approvedByUser?: boolean | null;
}) {
  if (!options.sessionId) {
    return;
  }

  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    runId: options.runId,
    stepId: options.stepId,
  });

  const scopedWhere = {
    id: options.toolCallId,
    tenantId,
    sessionId: options.sessionId,
  };

  const existing = await prisma.toolCall.findFirst({
    where: scopedWhere,
    select: { id: true },
  });

  const data = {
    toolName: options.toolName,
    tenantId,
    sessionId: options.sessionId,
    runId: options.runId ?? null,
    stepId: options.stepId ?? null,
    source: options.source ?? null,
    riskLevel: options.riskLevel ?? null,
    permissions: serializePermissions(options.permissions),
    argsJson: options.args ? JSON.stringify(options.args) : null,
    approvedByUser: options.approvedByUser ?? null,
    status: "started",
    startedAt: new Date(),
  };

  if (existing) {
    await prisma.toolCall.updateMany({
      where: scopedWhere,
      data,
    });
    return;
  }

  const foreign = await prisma.toolCall.findUnique({
    where: {
      id: options.toolCallId,
    },
    select: {
      id: true,
    },
  });

  if (foreign) {
    throw new Error(
      `ToolCall ${options.toolCallId} belongs to another tenant/session`
    );
  }

  await prisma.toolCall.create({
    data: {
      id: options.toolCallId,
      ...data,
    },
  });
}

export async function updateToolCallOutcome(options: {
  sessionId: string | null;
  tenantId?: string | null;
  toolCallId: string;
  status: string;
  resultSummary?: string;
  result?: unknown;
  errorMessage?: string;
  approvedByUser?: boolean | null;
  estimatedCostUsd?: number | null;
}) {
  if (!options.sessionId) {
    return;
  }

  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
  });

  const existing = await prisma.toolCall.findFirst({
    where: {
      id: options.toolCallId,
      tenantId,
      sessionId: options.sessionId,
    },
    select: {
      startedAt: true,
    },
  });

  if (!existing) {
    throw new Error(
      `ToolCall ${options.toolCallId} not found for tenant ${tenantId}`
    );
  }

  const finishedAt = new Date();
  const latencyMs = existing.startedAt
    ? finishedAt.getTime() - existing.startedAt.getTime()
    : null;

  await prisma.toolCall.updateMany({
    where: {
      id: options.toolCallId,
      tenantId,
      sessionId: options.sessionId,
    },
    data: {
      status: options.status,
      finishedAt,
      latencyMs,
      resultSummary: options.resultSummary ?? null,
      resultJson:
        options.result === undefined ? null : JSON.stringify(options.result),
      errorMessage: options.errorMessage ?? null,
      approvedByUser: options.approvedByUser ?? null,
      estimatedCostUsd: options.estimatedCostUsd ?? null,
    },
  });
}
