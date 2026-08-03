import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __clearPatchProposalsForTests,
  __setPatchProposalForTests,
  applyPatchProposal,
  getTenantPatchProposal,
  rejectPatchProposal,
  type StoredPatchProposal,
} from "./proposals";

function seedProposal(tenantId: string): StoredPatchProposal {
  const proposal: StoredPatchProposal = {
    id: `patch_${tenantId}`,
    tenantId,
    userId: "user-1",
    sessionId: null,
    title: "isolation",
    summary: "",
    createdAt: new Date().toISOString(),
    status: "pending",
    files: [],
  };

  __setPatchProposalForTests(proposal);
  return proposal;
}

describe("getTenantPatchProposal (production)", () => {
  afterEach(() => {
    __clearPatchProposalsForTests();
  });

  it("returns null for foreign-tenant proposal reads", () => {
    seedProposal("tenant-a");

    assert.equal(
      getTenantPatchProposal({
        proposalId: "patch_tenant-a",
        tenantId: "tenant-b",
      }),
      null
    );
    assert.equal(
      getTenantPatchProposal({
        proposalId: "patch_tenant-a",
        tenantId: "tenant-a",
      })?.id,
      "patch_tenant-a"
    );
  });

  it("rejects apply/reject for foreign tenants", async () => {
    seedProposal("tenant-a");

    await assert.rejects(
      () =>
        applyPatchProposal({
          proposalId: "patch_tenant-a",
          tenantId: "tenant-b",
        }),
      /Unknown patch proposal/
    );

    await assert.rejects(
      () =>
        rejectPatchProposal({
          proposalId: "patch_tenant-a",
          tenantId: "tenant-b",
        }),
      /Unknown patch proposal/
    );
  });
});
