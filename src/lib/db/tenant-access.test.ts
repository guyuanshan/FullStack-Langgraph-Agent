import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTenantPatchProposalAccess,
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

describe("tenant access helpers", () => {
  it("identifies TenantAccessError instances", () => {
    const error = new TenantAccessError("NOT_FOUND", 404, "missing");
    assert.equal(isTenantAccessError(error), true);
    assert.equal(isTenantAccessError(new Error("other")), false);
  });

  it("serializes tenant access errors to JSON responses", async () => {
    const response = tenantAccessErrorResponse(
      new TenantAccessError("FORBIDDEN", 403, "denied")
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "FORBIDDEN",
      message: "denied",
    });
  });
});

describe("role matrix", () => {
  it("allows write-capable roles to approve code patches", () => {
    assert.equal(canWriteCode("owner"), true);
    assert.equal(canWriteCode("admin"), true);
    assert.equal(canWriteCode("member"), true);
    assert.equal(canWriteCode("viewer"), false);
  });

  it("allows members to start runs but not viewers", () => {
    assert.equal(canStartAgentRun("owner"), true);
    assert.equal(canStartAgentRun("admin"), true);
    assert.equal(canStartAgentRun("member"), true);
    assert.equal(canStartAgentRun("viewer"), false);
    assert.equal(canViewSessions("viewer"), true);
    assert.equal(canCreateSession("viewer"), false);
    assert.equal(canCreateSession("member"), true);
  });

  it("restricts tool approvals by role and risk", () => {
    assert.equal(
      canApproveToolAction("viewer", {
        riskLevel: "confirm_required",
        permissions: ["read"],
      }),
      false
    );
    assert.equal(
      canApproveToolAction("member", {
        riskLevel: "confirm_required",
        permissions: ["read"],
      }),
      true
    );
    assert.equal(
      canApproveToolAction("member", {
        riskLevel: "confirm_required",
        permissions: ["write"],
      }),
      true
    );
    assert.equal(
      canApproveToolAction("member", {
        riskLevel: "dangerous",
        permissions: ["execute"],
      }),
      false
    );
    assert.equal(
      canApproveToolAction("admin", {
        riskLevel: "dangerous",
        permissions: ["execute"],
      }),
      true
    );
  });

  it("restricts session deletion by role and ownership", () => {
    const authMember = {
      userId: "user-1",
      tenantId: "tenant-a",
      role: "member" as const,
    };

    assert.equal(
      canDeleteSession(authMember, { userId: "user-1" }),
      true
    );
    assert.equal(
      canDeleteSession(authMember, { userId: "user-2" }),
      false
    );
    assert.equal(
      canDeleteSession(
        { ...authMember, role: "viewer" },
        { userId: "user-1" }
      ),
      false
    );
    assert.equal(
      canDeleteSession(
        { ...authMember, role: "admin" },
        { userId: "user-2" }
      ),
      true
    );
  });
});

describe("assertTenantPatchProposalAccess", () => {
  it("returns 404 for cross-tenant proposals", () => {
    assert.throws(
      () =>
        assertTenantPatchProposalAccess(
          { userId: "user-1", tenantId: "tenant-a", role: "admin" },
          { tenantId: "tenant-b" }
        ),
      (error: unknown) =>
        error instanceof TenantAccessError &&
        error.code === "NOT_FOUND" &&
        error.status === 404
    );
  });

  it("returns 403 when the role cannot write code", () => {
    assert.throws(
      () =>
        assertTenantPatchProposalAccess(
          { userId: "user-1", tenantId: "tenant-a", role: "viewer" },
          { tenantId: "tenant-a" }
        ),
      (error: unknown) =>
        error instanceof TenantAccessError &&
        error.code === "FORBIDDEN" &&
        error.status === 403
    );
  });

  it("allows same-tenant members", () => {
    assertTenantPatchProposalAccess(
      { userId: "user-1", tenantId: "tenant-a", role: "member" },
      { tenantId: "tenant-a" }
    );
  });
});
