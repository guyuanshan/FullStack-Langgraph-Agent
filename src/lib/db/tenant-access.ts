import "server-only";

import type { AuthContext } from "../auth/tenant-resolution";
import { prisma } from "./client";
import {
  assertTenantPatchProposalAccess,
  canDeleteSession,
  TenantAccessError,
} from "./tenant-access-policy";

export {
  assertCanApproveToolAction,
  assertCanCreateSession,
  assertCanStartAgentRun,
  canApproveToolAction,
  canCreateSession,
  canDeleteSession,
  canStartAgentRun,
  canViewSessions,
  canWriteCode,
  isTenantAccessError,
  TenantAccessError,
  tenantAccessErrorResponse,
} from "./tenant-access-policy";

export type TenantSession = {
  id: string;
  tenantId: string;
  userId: string | null;
  title: string | null;
  summary: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function requireTenantSession(
  auth: AuthContext,
  sessionId: string
): Promise<TenantSession> {
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      tenantId: auth.tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!session) {
    throw new TenantAccessError(
      "NOT_FOUND",
      404,
      "Session not found."
    );
  }

  return session;
}

export async function getSession(auth: AuthContext, sessionId: string) {
  return requireTenantSession(auth, sessionId);
}

export async function listSessions(auth: AuthContext) {
  return prisma.session.findMany({
    where: {
      tenantId: auth.tenantId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      updatedAt: true,
      createdAt: true,
      userId: true,
    },
  });
}

export async function deleteSession(auth: AuthContext, sessionId: string) {
  const session = await requireTenantSession(auth, sessionId);

  if (!canDeleteSession(auth, session)) {
    throw new TenantAccessError(
      "FORBIDDEN",
      403,
      "You do not have permission to delete this session."
    );
  }

  await prisma.session.deleteMany({
    where: {
      id: session.id,
      tenantId: auth.tenantId,
    },
  });

  return session;
}

export async function ensureTenantSession(
  auth: AuthContext,
  sessionId: string
): Promise<TenantSession> {
  const existing = await prisma.session.findFirst({
    where: {
      id: sessionId,
      tenantId: auth.tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (existing) {
    if (!existing.userId) {
      return prisma.session.update({
        where: {
          id: existing.id,
        },
        data: {
          userId: auth.userId,
        },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          title: true,
          summary: true,
          messageCount: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    return existing;
  }

  // Reject reuse of a session ID that already belongs to another tenant.
  const foreign = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
    },
  });

  if (foreign) {
    throw new TenantAccessError(
      "NOT_FOUND",
      404,
      "Session not found."
    );
  }

  return prisma.session.create({
    data: {
      id: sessionId,
      tenantId: auth.tenantId,
      userId: auth.userId,
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function listSessionRuns(auth: AuthContext, sessionId: string) {
  await requireTenantSession(auth, sessionId);

  return prisma.agentRun.findMany({
    where: {
      tenantId: auth.tenantId,
      sessionId,
    },
    orderBy: {
      startedAt: "desc",
    },
    take: 20,
    select: {
      id: true,
      runtimeType: true,
      trigger: true,
      status: true,
      completionReason: true,
      latestUserTask: true,
      startedAt: true,
      finishedAt: true,
      latencyMs: true,
      _count: {
        select: {
          steps: true,
          modelCalls: true,
          toolCalls: true,
          interrupts: true,
          errorLogs: true,
        },
      },
    },
  });
}

export async function getRunTrace(auth: AuthContext, runId: string) {
  const trace = await prisma.agentRun.findFirst({
    where: {
      id: runId,
      tenantId: auth.tenantId,
    },
    include: {
      steps: {
        orderBy: {
          startedAt: "asc",
        },
      },
      modelCalls: {
        orderBy: {
          createdAt: "asc",
        },
      },
      toolCalls: {
        orderBy: {
          createdAt: "asc",
        },
      },
      interrupts: {
        orderBy: {
          createdAt: "asc",
        },
      },
      errorLogs: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!trace) {
    throw new TenantAccessError("NOT_FOUND", 404, "Run not found.");
  }

  return trace;
}

export async function requireTenantPatchProposalAccess(
  auth: AuthContext,
  proposal: {
    tenantId: string;
    sessionId: string | null;
  }
) {
  assertTenantPatchProposalAccess(auth, proposal);

  if (proposal.sessionId) {
    await requireTenantSession(auth, proposal.sessionId);
  }
}

/**
 * Tenant-scoped session lookup for Runtime/writers that already hold tenantId
 * from AuthContext (never derive tenant from a bare session id).
 */
export async function requireSessionInTenant(
  tenantId: string,
  sessionId: string
): Promise<Pick<TenantSession, "id" | "tenantId" | "userId">> {
  if (!tenantId.trim()) {
    throw new Error("tenantId is required");
  }

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
    },
  });

  if (!session) {
    throw new TenantAccessError("NOT_FOUND", 404, "Session not found.");
  }

  return session;
}

export async function upsertTenantCheckpoint(options: {
  tenantId: string;
  sessionId: string;
  threadId: string;
  payload: unknown;
}) {
  await requireSessionInTenant(options.tenantId, options.sessionId);

  await prisma.checkpoint.upsert({
    where: {
      sessionId_threadId: {
        sessionId: options.sessionId,
        threadId: options.threadId,
      },
    },
    update: {
      payload: JSON.stringify(options.payload),
      tenantId: options.tenantId,
    },
    create: {
      tenantId: options.tenantId,
      sessionId: options.sessionId,
      threadId: options.threadId,
      payload: JSON.stringify(options.payload),
    },
  });
}

export async function getTenantCheckpoint(options: {
  tenantId: string;
  sessionId: string;
  threadId: string;
}) {
  await requireSessionInTenant(options.tenantId, options.sessionId);

  const checkpoint = await prisma.checkpoint.findFirst({
    where: {
      tenantId: options.tenantId,
      sessionId: options.sessionId,
      threadId: options.threadId,
    },
  });

  if (!checkpoint) {
    return null;
  }

  return JSON.parse(checkpoint.payload) as Record<string, unknown>;
}
