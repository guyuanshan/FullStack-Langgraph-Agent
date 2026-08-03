import type { AuthContext, TenantRole } from "../auth/tenant-resolution";
import type { ToolPermission, ToolRiskLevel } from "../tools/types";

export class TenantAccessError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN",
    readonly status: 403 | 404,
    message: string
  ) {
    super(message);
    this.name = "TenantAccessError";
  }
}

export function isTenantAccessError(
  error: unknown
): error is TenantAccessError {
  return error instanceof TenantAccessError;
}

/** View sessions, messages, and traces — all tenant roles. */
export function canViewSessions(_role: TenantRole) {
  return true;
}

/** Start an agent run — viewers are read-only. */
export function canStartAgentRun(role: TenantRole) {
  return role === "owner" || role === "admin" || role === "member";
}

/** Create sessions is a state-changing write — viewers cannot. */
export function canCreateSession(role: TenantRole) {
  return canStartAgentRun(role);
}

export function canWriteCode(role: TenantRole) {
  return role === "owner" || role === "admin" || role === "member";
}

/**
 * Approve a pending tool/plan interrupt.
 * - viewer: never
 * - member: non-dangerous actions (write/execute allowed when risk ≠ dangerous)
 * - owner/admin: always
 */
export function canApproveToolAction(
  role: TenantRole,
  options: {
    riskLevel: ToolRiskLevel;
    permissions?: ToolPermission[];
  }
) {
  if (role === "viewer") {
    return false;
  }

  if (role === "owner" || role === "admin") {
    return true;
  }

  // member
  if (options.riskLevel === "dangerous") {
    return false;
  }

  const permissions = options.permissions ?? [];
  const isReadOnlyExternal =
    permissions.length > 0 && permissions.every((item) => item === "read");

  if (isReadOnlyExternal) {
    return true;
  }

  // write / execute / delete: member allowed when not dangerous ("按策略")
  return true;
}

export function canDeleteSession(
  auth: AuthContext,
  session: { userId: string | null }
) {
  if (auth.role === "owner" || auth.role === "admin") {
    return true;
  }

  if (auth.role === "viewer") {
    return false;
  }

  return session.userId === auth.userId;
}

export function assertCanStartAgentRun(auth: AuthContext) {
  if (!canStartAgentRun(auth.role)) {
    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "You do not have permission to start an agent run."
    );
  }
}

export function assertCanCreateSession(auth: AuthContext) {
  if (!canCreateSession(auth.role)) {
    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "You do not have permission to create a session."
    );
  }
}

export function assertCanApproveToolAction(
  auth: AuthContext,
  options: {
    riskLevel: ToolRiskLevel;
    permissions?: ToolPermission[];
  }
) {
  if (!canApproveToolAction(auth.role, options)) {
    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "You do not have permission to approve this action."
    );
  }
}

export function assertTenantPatchProposalAccess(
  auth: AuthContext,
  proposal: {
    tenantId: string;
  }
) {
  if (proposal.tenantId !== auth.tenantId) {
    throw new TenantAccessError("NOT_FOUND", 404, "Patch proposal not found.");
  }

  if (!canWriteCode(auth.role)) {
    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "You do not have permission to approve code patches."
    );
  }
}

export function tenantAccessErrorResponse(error: TenantAccessError) {
  return Response.json(
    {
      error: error.code,
      message: error.message,
    },
    { status: error.status }
  );
}
