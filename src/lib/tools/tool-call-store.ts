import { prisma } from "../db/client";
import type { ToolPermission, ToolRiskLevel } from "./types";

function serializePermissions(permissions?: ToolPermission[]) {
  return permissions?.length ? permissions.join(",") : null;
}

export async function upsertToolCallStart(options: {
  sessionId: string | null;
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

  await prisma.toolCall.upsert({
    where: {
      id: options.toolCallId,
    },
    update: {
      toolName: options.toolName,
      runId: options.runId ?? null,
      stepId: options.stepId ?? null,
      source: options.source ?? null,
      riskLevel: options.riskLevel ?? null,
      permissions: serializePermissions(options.permissions),
      argsJson: options.args ? JSON.stringify(options.args) : null,
      approvedByUser: options.approvedByUser ?? null,
      status: "started",
      startedAt: new Date(),
    },
    create: {
      id: options.toolCallId,
      sessionId: options.sessionId,
      runId: options.runId ?? null,
      stepId: options.stepId ?? null,
      toolName: options.toolName,
      source: options.source ?? null,
      riskLevel: options.riskLevel ?? null,
      permissions: serializePermissions(options.permissions),
      argsJson: options.args ? JSON.stringify(options.args) : null,
      approvedByUser: options.approvedByUser ?? null,
      status: "started",
      startedAt: new Date(),
    },
  });
}

export async function updateToolCallOutcome(options: {
  sessionId: string | null;
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

  const existing = await prisma.toolCall.findUnique({
    where: {
      id: options.toolCallId,
    },
    select: {
      startedAt: true,
    },
  });
  const finishedAt = new Date();
  const latencyMs = existing?.startedAt
    ? finishedAt.getTime() - existing.startedAt.getTime()
    : null;

  await prisma.toolCall.update({
    where: {
      id: options.toolCallId,
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
