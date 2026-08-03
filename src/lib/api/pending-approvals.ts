import "server-only";

import type { AuthContext } from "../auth/tenant-resolution";
import { prisma } from "../db/client";
import {
  assertCanApproveToolAction,
  TenantAccessError,
} from "../db/tenant-access-policy";
import type { ToolPermission, ToolRiskLevel } from "../tools/types";
import type { RuntimeType } from "../observability/store";

export const PENDING_APPROVAL_TTL_MS = 30 * 60 * 1000;

const TOOL_RISK_LEVELS = new Set<ToolRiskLevel>([
  "safe",
  "confirm_required",
  "dangerous",
]);

const TOOL_PERMISSIONS = new Set<ToolPermission>([
  "read",
  "write",
  "delete",
  "execute",
]);

const RUNTIME_TYPES = new Set<RuntimeType>([
  "manual",
  "langgraph",
  "multi_agent",
]);

export type PendingApprovalRecord = {
  id: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  runtimeType: RuntimeType;
  kind: string;
  toolCallId: string | null;
  toolName: string | null;
  riskLevel: ToolRiskLevel;
  permissions: ToolPermission[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseRiskLevel(value: unknown): ToolRiskLevel {
  if (typeof value === "string" && TOOL_RISK_LEVELS.has(value as ToolRiskLevel)) {
    return value as ToolRiskLevel;
  }

  // Fail closed: unknown/missing risk is treated as dangerous.
  return "dangerous";
}

function parsePermissions(value: unknown): ToolPermission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ToolPermission =>
      typeof item === "string" && TOOL_PERMISSIONS.has(item as ToolPermission)
  );
}

function parseRuntimeType(value: string): RuntimeType {
  if (RUNTIME_TYPES.has(value as RuntimeType)) {
    return value as RuntimeType;
  }

  throw new TenantAccessError(
    "FORBIDDEN",
    403,
    "Pending approval is bound to an unsupported runtime."
  );
}

function parsePayload(payloadJson: string | null) {
  if (!payloadJson) {
    return null;
  }

  try {
    return asRecord(JSON.parse(payloadJson));
  } catch {
    return null;
  }
}

export function buildApprovalPayload(input: {
  toolCallId?: string | null;
  toolName?: string | null;
  args?: unknown;
  toolSummary?: string | null;
  planSummary?: string | null;
  riskLevel: ToolRiskLevel;
  permissions: ToolPermission[];
}) {
  return {
    toolCallId: input.toolCallId ?? null,
    toolName: input.toolName ?? null,
    args: input.args ?? null,
    toolSummary: input.toolSummary ?? null,
    planSummary: input.planSummary ?? null,
    riskLevel: input.riskLevel,
    permissions: input.permissions,
  };
}

function toPendingApprovalRecord(input: {
  id: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  runtimeType: string;
  kind: string;
  payloadJson: string | null;
}): PendingApprovalRecord {
  const payload = parsePayload(input.payloadJson);

  return {
    id: input.id,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    runId: input.runId,
    runtimeType: parseRuntimeType(input.runtimeType),
    kind: input.kind,
    toolCallId:
      typeof payload?.toolCallId === "string" ? payload.toolCallId : null,
    toolName: typeof payload?.toolName === "string" ? payload.toolName : null,
    riskLevel: parseRiskLevel(payload?.riskLevel),
    permissions: parsePermissions(payload?.permissions),
  };
}

/**
 * Read-only load of a pending approval + originating run runtime.
 * Does not mutate status. Risk/permissions come only from persisted payload.
 */
export async function loadPendingApproval(options: {
  auth: AuthContext;
  approvalId: string;
  expectedSessionId?: string;
}): Promise<PendingApprovalRecord> {
  const pending = await prisma.interruptEvent.findFirst({
    where: {
      id: options.approvalId,
      tenantId: options.auth.tenantId,
      status: "pending",
    },
    select: {
      id: true,
      tenantId: true,
      sessionId: true,
      runId: true,
      kind: true,
      payloadJson: true,
      createdAt: true,
      run: {
        select: {
          runtimeType: true,
        },
      },
    },
  });

  if (!pending) {
    throw new TenantAccessError(
      "NOT_FOUND",
      404,
      "Pending approval not found."
    );
  }

  if (!pending.sessionId) {
    throw new TenantAccessError(
      "NOT_FOUND",
      404,
      "Pending approval is not bound to a session."
    );
  }

  if (
    options.expectedSessionId &&
    pending.sessionId !== options.expectedSessionId
  ) {
    throw new TenantAccessError(
      "NOT_FOUND",
      404,
      "Pending approval not found for this session."
    );
  }

  if (Date.now() - pending.createdAt.getTime() > PENDING_APPROVAL_TTL_MS) {
    await prisma.interruptEvent.updateMany({
      where: {
        id: pending.id,
        tenantId: options.auth.tenantId,
        status: "pending",
      },
      data: {
        status: "expired",
        reason: "Approval expired.",
      },
    });

    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "Pending approval has expired."
    );
  }

  return toPendingApprovalRecord({
    id: pending.id,
    tenantId: pending.tenantId,
    sessionId: pending.sessionId,
    runId: pending.runId,
    runtimeType: pending.run.runtimeType,
    kind: pending.kind,
    payloadJson: pending.payloadJson,
  });
}

/**
 * Atomically consume a pending approval after authorization succeeded.
 */
export async function consumePendingApproval(options: {
  auth: AuthContext;
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<void> {
  const updated = await prisma.interruptEvent.updateMany({
    where: {
      id: options.approvalId,
      tenantId: options.auth.tenantId,
      status: "pending",
    },
    data: {
      status: options.decision,
      reason: options.reason ?? null,
    },
  });

  if (updated.count !== 1) {
    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "Pending approval was already decided."
    );
  }
}

/**
 * Correct decision order:
 * 1) read-only load pending approval + server risk/runtime
 * 2) role authorization
 * 3) atomic consume only if still pending
 */
export async function authorizeAndConsumePendingApproval(options: {
  auth: AuthContext;
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
  expectedSessionId?: string;
}): Promise<PendingApprovalRecord> {
  const approval = await loadPendingApproval({
    auth: options.auth,
    approvalId: options.approvalId,
    expectedSessionId: options.expectedSessionId,
  });

  assertCanApproveToolAction(options.auth, {
    riskLevel: approval.riskLevel,
    permissions: approval.permissions,
  });

  await consumePendingApproval({
    auth: options.auth,
    approvalId: approval.id,
    decision: options.decision,
    reason: options.reason,
  });

  return approval;
}
