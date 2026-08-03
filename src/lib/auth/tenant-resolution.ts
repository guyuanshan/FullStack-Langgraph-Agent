import { AuthContextError } from "./error-types";

export const TENANT_ROLES = ["owner", "admin", "member", "viewer"] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export type AuthContext = Readonly<{
  userId: string;
  tenantId: string;
  role: TenantRole;
}>;

export type TenantMembershipRecord = {
  tenantId: string;
  role: string;
};

export function isTenantRole(value: string): value is TenantRole {
  return TENANT_ROLES.includes(value as TenantRole);
}

export function resolveAuthContextFromMemberships(input: {
  userId: string;
  activeTenantId: string | null;
  memberships: TenantMembershipRecord[];
}): AuthContext {
  const { userId, activeTenantId, memberships } = input;

  if (activeTenantId) {
    const membership = memberships.find(
      (item) => item.tenantId === activeTenantId
    );

    if (!membership || !isTenantRole(membership.role)) {
      throw new AuthContextError("INVALID_TENANT_MEMBERSHIP", 403);
    }

    return Object.freeze({
      userId,
      tenantId: membership.tenantId,
      role: membership.role,
    });
  }

  if (memberships.length === 0) {
    throw new AuthContextError("NO_TENANT_MEMBERSHIP", 403);
  }

  if (memberships.length > 1) {
    throw new AuthContextError("TENANT_SELECTION_REQUIRED", 409);
  }

  const [membership] = memberships;

  if (!membership || !isTenantRole(membership.role)) {
    throw new AuthContextError("INVALID_TENANT_MEMBERSHIP", 403);
  }

  return Object.freeze({
    userId,
    tenantId: membership.tenantId,
    role: membership.role,
  });
}
