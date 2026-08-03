import "server-only";

import { prisma } from "./client";

/** Matches AUTH_BOOTSTRAP_TENANT_ID default used by scripts/bootstrap-auth.mjs */
export const DEFAULT_TENANT_ID = "default-tenant";

export async function assertTenantConsistency(input: {
  tenantId: string;
  sessionId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  requireExistingParents?: boolean;
}) {
  const requireExistingParents = input.requireExistingParents ?? true;

  if (input.sessionId) {
    const session = await prisma.session.findUnique({
      where: {
        id: input.sessionId,
      },
      select: {
        tenantId: true,
      },
    });

    if (!session) {
      if (requireExistingParents) {
        throw new Error(
          `TENANT_MISMATCH: session ${input.sessionId} does not exist.`
        );
      }
    } else if (session.tenantId !== input.tenantId) {
      throw new Error(
        `TENANT_MISMATCH: session ${input.sessionId} belongs to ${session.tenantId}, not ${input.tenantId}.`
      );
    }
  }

  if (input.runId) {
    const run = await prisma.agentRun.findUnique({
      where: {
        id: input.runId,
      },
      select: {
        tenantId: true,
      },
    });

    if (!run) {
      if (requireExistingParents) {
        throw new Error(`TENANT_MISMATCH: run ${input.runId} does not exist.`);
      }
    } else if (run.tenantId !== input.tenantId) {
      throw new Error(
        `TENANT_MISMATCH: run ${input.runId} belongs to ${run.tenantId}, not ${input.tenantId}.`
      );
    }
  }

  if (input.stepId) {
    const step = await prisma.agentStep.findUnique({
      where: {
        id: input.stepId,
      },
      select: {
        tenantId: true,
      },
    });

    if (!step) {
      if (requireExistingParents) {
        throw new Error(`TENANT_MISMATCH: step ${input.stepId} does not exist.`);
      }
    } else if (step.tenantId !== input.tenantId) {
      throw new Error(
        `TENANT_MISMATCH: step ${input.stepId} belongs to ${step.tenantId}, not ${input.tenantId}.`
      );
    }
  }
}

/**
 * Resolve the tenant for a write, then verify it matches every provided parent.
 * An explicit tenantId is never trusted alone when sessionId/runId/stepId is present.
 */
export async function resolveWriteTenantId(input: {
  tenantId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  stepId?: string | null;
}) {
  let tenantId = input.tenantId?.trim() || null;

  if (!tenantId && input.sessionId) {
    const session = await prisma.session.findUnique({
      where: {
        id: input.sessionId,
      },
      select: {
        tenantId: true,
      },
    });
    tenantId = session?.tenantId ?? null;
  }

  if (!tenantId && input.runId) {
    const run = await prisma.agentRun.findUnique({
      where: {
        id: input.runId,
      },
      select: {
        tenantId: true,
      },
    });
    tenantId = run?.tenantId ?? null;
  }

  if (!tenantId && input.stepId) {
    const step = await prisma.agentStep.findUnique({
      where: {
        id: input.stepId,
      },
      select: {
        tenantId: true,
      },
    });
    tenantId = step?.tenantId ?? null;
  }

  if (!tenantId) {
    throw new Error(
      "TENANT_ID_REQUIRED: provide tenantId or a session/run/step that already has one."
    );
  }

  await assertTenantConsistency({
    tenantId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    requireExistingParents: Boolean(
      input.sessionId || input.runId || input.stepId
    ),
  });

  return tenantId;
}
