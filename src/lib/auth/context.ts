import "server-only";

import { parseCookies } from "better-auth/cookies";
import { prisma } from "../db/client";
import { ACTIVE_TENANT_COOKIE_NAME } from "./constants";
import { AuthContextError } from "./error-types";
import { auth } from "./server";
import {
  resolveAuthContextFromMemberships,
  type AuthContext,
  type TenantRole,
} from "./tenant-resolution";

export type { AuthContext, TenantRole };
export { TENANT_ROLES, isTenantRole } from "./tenant-resolution";

export type AuthenticatedUser = Readonly<{
  id: string;
  email: string;
  name: string;
}>;

export function readActiveTenantId(headers: Headers) {
  const cookieHeader = headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const value = parseCookies(cookieHeader).get(ACTIVE_TENANT_COOKIE_NAME);

  if (!value || value.length > 128) {
    return null;
  }

  return value;
}

export async function requireAuthenticatedUserFromHeaders(
  headers: Headers
): Promise<AuthenticatedUser> {
  const session = await auth.api.getSession({
    headers,
  });

  if (!session?.user?.id) {
    throw new AuthContextError("UNAUTHENTICATED", 401);
  }

  return Object.freeze({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
}

export async function requireAuthenticatedUser(
  request: Request
): Promise<AuthenticatedUser> {
  return requireAuthenticatedUserFromHeaders(request.headers);
}

export async function requireAuthContextFromHeaders(
  headers: Headers
): Promise<AuthContext> {
  const user = await requireAuthenticatedUserFromHeaders(headers);
  const activeTenantId = readActiveTenantId(headers);

  if (activeTenantId) {
    const membership = await prisma.tenantMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId: activeTenantId,
          userId: user.id,
        },
      },
      select: {
        tenantId: true,
        role: true,
        tenant: {
          select: {
            isActive: true,
          },
        },
      },
    });

    if (!membership?.tenant.isActive) {
      throw new AuthContextError("INVALID_TENANT_MEMBERSHIP", 403);
    }

    return resolveAuthContextFromMemberships({
      userId: user.id,
      activeTenantId,
      memberships: membership
        ? [{ tenantId: membership.tenantId, role: membership.role }]
        : [],
    });
  }

  const memberships = await prisma.tenantMember.findMany({
    where: {
      userId: user.id,
      tenant: {
        isActive: true,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 2,
    select: {
      tenantId: true,
      role: true,
    },
  });

  return resolveAuthContextFromMemberships({
    userId: user.id,
    activeTenantId: null,
    memberships,
  });
}

export async function requireAuthContext(
  request: Request
): Promise<AuthContext> {
  return requireAuthContextFromHeaders(request.headers);
}
