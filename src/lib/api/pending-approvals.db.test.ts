import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { prisma } from "../db/client";
import {
  authorizeAndConsumePendingApproval,
  buildApprovalPayload,
} from "./pending-approvals";
import {
  isTenantAccessError,
  TenantAccessError,
} from "../db/tenant-access-policy";

const seededIds: {
  tenantId: string;
  sessionId: string;
  runId: string;
  approvalId: string;
}[] = [];

async function seedDangerousPendingApproval() {
  const suffix = crypto.randomUUID();
  const tenantId = `test-tenant-${suffix}`;
  const sessionId = `test-session-${suffix}`;
  const runId = `test-run-${suffix}`;

  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: `Test Tenant ${suffix}`,
    },
  });

  await prisma.session.create({
    data: {
      id: sessionId,
      tenantId,
      title: "approval authz",
    },
  });

  await prisma.agentRun.create({
    data: {
      id: runId,
      tenantId,
      sessionId,
      runtimeType: "langgraph",
      trigger: "request",
      status: "interrupted",
    },
  });

  const approval = await prisma.interruptEvent.create({
    data: {
      tenantId,
      runId,
      sessionId,
      kind: "tool_confirmation",
      status: "pending",
      message: "dangerous tool",
      payloadJson: JSON.stringify(
        buildApprovalPayload({
          toolCallId: `call-${suffix}`,
          toolName: "browser_click",
          args: { selector: "#pay" },
          riskLevel: "dangerous",
          permissions: ["execute"],
        })
      ),
    },
    select: { id: true },
  });

  seededIds.push({
    tenantId,
    sessionId,
    runId,
    approvalId: approval.id,
  });

  return {
    tenantId,
    sessionId,
    runId,
    approvalId: approval.id,
  };
}

async function cleanupSeeded() {
  while (seededIds.length > 0) {
    const item = seededIds.pop();
    if (!item) {
      continue;
    }

    await prisma.interruptEvent.deleteMany({
      where: { id: item.approvalId },
    });
    await prisma.agentRun.deleteMany({
      where: { id: item.runId, tenantId: item.tenantId },
    });
    await prisma.session.deleteMany({
      where: { id: item.sessionId, tenantId: item.tenantId },
    });
    await prisma.tenant.deleteMany({
      where: { id: item.tenantId },
    });
  }
}

describe("authorizeAndConsumePendingApproval (db)", () => {
  afterEach(async () => {
    await cleanupSeeded();
  });

  it("keeps status pending when member is forbidden from approving dangerous", async () => {
    const seeded = await seedDangerousPendingApproval();
    const memberAuth = {
      userId: "member-user",
      tenantId: seeded.tenantId,
      role: "member" as const,
    };

    await assert.rejects(
      () =>
        authorizeAndConsumePendingApproval({
          auth: memberAuth,
          approvalId: seeded.approvalId,
          decision: "approved",
        }),
      (error: unknown) =>
        isTenantAccessError(error) &&
        error instanceof TenantAccessError &&
        error.code === "FORBIDDEN" &&
        error.status === 403
    );

    const persisted = await prisma.interruptEvent.findUnique({
      where: { id: seeded.approvalId },
      select: { status: true },
    });

    assert.equal(persisted?.status, "pending");
  });

  it("consumes only after authorization for admin on dangerous", async () => {
    const seeded = await seedDangerousPendingApproval();
    const adminAuth = {
      userId: "admin-user",
      tenantId: seeded.tenantId,
      role: "admin" as const,
    };

    const approval = await authorizeAndConsumePendingApproval({
      auth: adminAuth,
      approvalId: seeded.approvalId,
      decision: "approved",
    });

    assert.equal(approval.runtimeType, "langgraph");
    assert.equal(approval.riskLevel, "dangerous");

    const persisted = await prisma.interruptEvent.findUnique({
      where: { id: seeded.approvalId },
      select: { status: true },
    });

    assert.equal(persisted?.status, "approved");
  });
});
