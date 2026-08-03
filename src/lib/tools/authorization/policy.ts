import { getGitPushTarget } from "../../code-agent/git";
import { getTool } from "../index";
import {
  getToolPolicyDenyReason,
  resolveToolPermissions,
  resolveToolRiskLevel,
} from "../policy";
import { summarizeToolArgs } from "../summary";
import type {
  ToolAuthorization,
  ToolPolicyDecision,
  ToolPolicyInput,
} from "./types";

function deny(reason: string): ToolPolicyDecision {
  return {
    action: "deny",
    riskLevel: "dangerous",
    reason,
  };
}

export function decideToolPolicy(
  input: ToolPolicyInput
): ToolPolicyDecision {
  if (!input.registered) {
    return deny(`Unknown tool: ${input.toolName}`);
  }

  if (!input.riskLevel) {
    return deny(`Tool ${input.toolName} is missing risk metadata.`);
  }

  if (input.permissions.length === 0) {
    return deny(`Tool ${input.toolName} is missing permission metadata.`);
  }

  const denyReason = getToolPolicyDenyReason(
    input.toolName,
    input.auth,
    input.args
  );

  if (denyReason) {
    return deny(denyReason);
  }

  if (input.riskLevel === "safe") {
    return {
      action: "allow",
      riskLevel: "safe",
      reason:
        input.source === "mcp"
          ? "Registered MCP read-only tool with complete metadata."
          : "Registered local safe tool with complete metadata.",
    };
  }

  return {
    action: "require_approval",
    riskLevel: input.riskLevel,
    requiredRole:
      input.riskLevel === "dangerous" ? "admin" : "member",
    reason: `Tool ${input.toolName} requires per-call approval.`,
  };
}

async function resolveAuthorizationSummary(
  toolName: string,
  args: Record<string, unknown>
) {
  if (toolName !== "git_push_branch") {
    return summarizeToolArgs(args);
  }

  const fallbackRemote =
    typeof args.remote === "string" && args.remote.trim()
      ? args.remote.trim()
      : "origin";
  const fallbackBranch =
    typeof args.branchName === "string" && args.branchName.trim()
      ? args.branchName.trim()
      : "<current>";

  try {
    const target = await getGitPushTarget({
      remote: fallbackRemote,
      branchName:
        fallbackBranch === "<current>" ? undefined : fallbackBranch,
    });

    return `repository=${target.repository} · remote=${target.remote} · branch=${target.branch}`;
  } catch {
    return `repository=<unavailable> · remote=${fallbackRemote} · branch=${fallbackBranch}`;
  }
}

export async function evaluateToolAuthorization(input: {
  auth: ToolPolicyInput["auth"];
  sessionId: string;
  projectId?: string;
  toolName: string;
  args: ToolPolicyInput["args"];
}): Promise<ToolAuthorization> {
  const tool = await getTool(input.toolName);

  if (!tool) {
    return {
      source: "local",
      permissions: [],
      summary: summarizeToolArgs(input.args),
      decision: decideToolPolicy({
        ...input,
        source: "local",
        permissions: [],
        registered: false,
      }),
    };
  }

  const permissions = resolveToolPermissions(tool) ?? [];
  const riskLevel = resolveToolRiskLevel(tool, input.args);
  const source = tool.source ?? "local";

  return {
    source,
    permissions,
    summary: await resolveAuthorizationSummary(tool.name, input.args),
    decision: decideToolPolicy({
      ...input,
      source,
      permissions,
      riskLevel,
      registered: true,
    }),
  };
}
