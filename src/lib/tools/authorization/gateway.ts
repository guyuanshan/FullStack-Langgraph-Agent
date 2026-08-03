import "server-only";

import { canApproveToolAction } from "../../db/tenant-access-policy";
import { requireSessionInTenant } from "../../db/tenant-access";
import { getTool } from "../index";
import { invokeRegisteredTool } from "./executor";
import { evaluateToolAuthorization } from "./policy";
import type {
  AuthorizeAndExecuteToolInput,
  ToolGatewayResult,
} from "./types";

export async function authorizeAndExecuteTool(
  input: AuthorizeAndExecuteToolInput
): Promise<ToolGatewayResult> {
  const authorization = await evaluateToolAuthorization(input);

  if (authorization.decision.action === "deny") {
    return {
      ...authorization,
      status: "denied",
      error: authorization.decision.reason,
    };
  }

  if (
    authorization.decision.action === "require_approval" &&
    !input.approval?.approved
  ) {
    return {
      ...authorization,
      status: "approval_required",
      error: authorization.decision.reason,
    };
  }

  if (
    authorization.decision.action === "require_approval" &&
    !canApproveToolAction(input.auth.role, {
      riskLevel: authorization.decision.riskLevel,
      permissions: authorization.permissions,
    })
  ) {
    return {
      ...authorization,
      status: "denied",
      error: "Current tenant role cannot approve this tool action.",
    };
  }

  if (input.auth.tenantId.trim() === "" || input.sessionId.trim() === "") {
    return {
      ...authorization,
      status: "denied",
      error: "Tool execution requires an authenticated tenant session.",
    };
  }

  await requireSessionInTenant(input.auth.tenantId, input.sessionId);

  const tool = await getTool(input.toolName);

  if (!tool) {
    return {
      ...authorization,
      status: "denied",
      error: `Unknown tool: ${input.toolName}`,
    };
  }

  const execution = await invokeRegisteredTool(
    tool,
    input.executionArgs ?? input.args
  );

  if (execution.ok) {
    return {
      ...authorization,
      status: "success",
      result: execution.result,
    };
  }

  return {
    ...authorization,
    status: "error",
    error: execution.error,
  };
}
