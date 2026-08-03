import "server-only";

import {
  getTenantPatchProposal,
  rejectPatchProposal,
} from "../code-agent/proposals";
import type { AuthContext } from "../auth/context";
import {
  requireTenantPatchProposalAccess,
  TenantAccessError,
} from "../db/tenant-access";
import type { PatchDecisionBody } from "./schemas";
import { authorizeAndExecuteTool } from "../tools/authorization";

export async function decidePatchProposal(
  auth: AuthContext,
  proposalId: string,
  body: PatchDecisionBody
) {
  const proposal = getTenantPatchProposal({
    proposalId,
    tenantId: auth.tenantId,
  });

  if (!proposal) {
    throw new TenantAccessError(
      "NOT_FOUND",
      404,
      "Patch proposal not found."
    );
  }

  await requireTenantPatchProposalAccess(auth, proposal);

  let result: unknown;

  if (body.action === "apply") {
    if (!proposal.sessionId) {
      throw new TenantAccessError(
        "FORBIDDEN",
        403,
        "Patch proposal is not bound to a tenant session."
      );
    }

    const args = {
      proposalId,
      files: body.files,
    };
    const execution = await authorizeAndExecuteTool({
      auth,
      sessionId: proposal.sessionId,
      runId: null,
      stepId: null,
      toolCallId: `patch:${proposalId}`,
      toolName: "code_apply_patch",
      args,
      executionArgs: {
        ...args,
        tenantId: auth.tenantId,
      },
      approval: { approved: true },
    });

    if (execution.status !== "success") {
      throw new Error(execution.error);
    }

    result = execution.result;
  } else {
    result = await rejectPatchProposal({
      proposalId,
      tenantId: auth.tenantId,
      reason: body.reason,
    });
  }

  return {
    ok: true as const,
    result,
  };
}
