import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthContextError } from "./error-types";
import { resolveAuthContextFromMemberships } from "./tenant-resolution";

describe("resolveAuthContextFromMemberships", () => {
  it("uses the active tenant membership when valid", () => {
    const context = resolveAuthContextFromMemberships({
      userId: "user-1",
      activeTenantId: "tenant-b",
      memberships: [
        { tenantId: "tenant-a", role: "member" },
        { tenantId: "tenant-b", role: "admin" },
      ],
    });

    assert.deepEqual(context, {
      userId: "user-1",
      tenantId: "tenant-b",
      role: "admin",
    });
  });

  it("rejects an active tenant the user does not belong to", () => {
    assert.throws(
      () =>
        resolveAuthContextFromMemberships({
          userId: "user-1",
          activeTenantId: "tenant-x",
          memberships: [{ tenantId: "tenant-a", role: "owner" }],
        }),
      (error: unknown) =>
        error instanceof AuthContextError &&
        error.code === "INVALID_TENANT_MEMBERSHIP" &&
        error.status === 403
    );
  });

  it("defaults to the sole membership when no active tenant is set", () => {
    const context = resolveAuthContextFromMemberships({
      userId: "user-1",
      activeTenantId: null,
      memberships: [{ tenantId: "tenant-a", role: "owner" }],
    });

    assert.deepEqual(context, {
      userId: "user-1",
      tenantId: "tenant-a",
      role: "owner",
    });
  });

  it("requires selection when the user has multiple memberships", () => {
    assert.throws(
      () =>
        resolveAuthContextFromMemberships({
          userId: "user-1",
          activeTenantId: null,
          memberships: [
            { tenantId: "tenant-a", role: "owner" },
            { tenantId: "tenant-b", role: "member" },
          ],
        }),
      (error: unknown) =>
        error instanceof AuthContextError &&
        error.code === "TENANT_SELECTION_REQUIRED" &&
        error.status === 409
    );
  });

  it("rejects users without any membership", () => {
    assert.throws(
      () =>
        resolveAuthContextFromMemberships({
          userId: "user-1",
          activeTenantId: null,
          memberships: [],
        }),
      (error: unknown) =>
        error instanceof AuthContextError &&
        error.code === "NO_TENANT_MEMBERSHIP" &&
        error.status === 403
    );
  });

  it("rejects unknown roles", () => {
    assert.throws(
      () =>
        resolveAuthContextFromMemberships({
          userId: "user-1",
          activeTenantId: "tenant-a",
          memberships: [{ tenantId: "tenant-a", role: "superuser" }],
        }),
      (error: unknown) =>
        error instanceof AuthContextError &&
        error.code === "INVALID_TENANT_MEMBERSHIP"
    );
  });
});
