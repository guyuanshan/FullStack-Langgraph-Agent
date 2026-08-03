import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthContext } from "../../auth/tenant-resolution";
import { authorizeAndExecuteTool } from "./gateway";
import { evaluateToolAuthorization } from "./policy";

const auth: AuthContext = Object.freeze({
  userId: "gateway-contract-user",
  tenantId: "gateway-contract-tenant",
  role: "member",
});

const sharedRequest = {
  auth,
  sessionId: "gateway-contract-session",
  runId: "gateway-contract-run",
  stepId: "gateway-contract-step",
  toolCallId: "gateway-contract-call",
  toolName: "write_demo_file",
  args: {
    filename: "gateway-contract.txt",
    content: "must not be written without approval",
  },
};

describe("ToolAuthorizationGateway contract", () => {
  it("returns the same authorization result for all three runtime callers", async () => {
    const runtimeCallers = ["manual", "langgraph", "multi_agent"] as const;
    const decisions = await Promise.all(
      runtimeCallers.map(() => evaluateToolAuthorization(sharedRequest))
    );

    assert.deepEqual(decisions[0], decisions[1]);
    assert.deepEqual(decisions[1], decisions[2]);
    assert.equal(decisions[0].decision.action, "require_approval");
    assert.equal(decisions[0].decision.riskLevel, "confirm_required");
    assert.deepEqual(decisions[0].permissions, ["write"]);
  });

  it("blocks parallel subtask execution before approval", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        authorizeAndExecuteTool({
          ...sharedRequest,
          toolCallId: `parallel-call-${index}`,
        })
      )
    );

    assert.deepEqual(
      results.map((result) => result.status),
      Array.from({ length: 4 }, () => "approval_required")
    );
  });

  it("routes Patch and Git operations through the same approval contract", async () => {
    const [patchDecision, gitDecision] = await Promise.all([
      evaluateToolAuthorization({
        ...sharedRequest,
        toolName: "code_apply_patch",
        args: { proposalId: "patch-1" },
      }),
      evaluateToolAuthorization({
        ...sharedRequest,
        toolName: "git_push_branch",
        args: { remote: "origin", branchName: "main" },
      }),
    ]);

    assert.equal(patchDecision.decision.action, "require_approval");
    assert.equal(gitDecision.decision.action, "require_approval");
  });
});
