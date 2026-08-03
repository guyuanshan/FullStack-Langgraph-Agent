import type {
  ToolPermission,
  ToolRiskLevel,
} from "../tools/types";

export type McpToolSecurityMetadata = Readonly<{
  riskLevel: ToolRiskLevel;
  permissions: readonly ToolPermission[];
}>;

export const MCP_TOOL_SECURITY = {
  fs_read_text: { riskLevel: "safe", permissions: ["read"] },
  fs_list_dir: { riskLevel: "safe", permissions: ["read"] },
  fs_search_files: { riskLevel: "safe", permissions: ["read"] },
  fs_write_text: {
    riskLevel: "confirm_required",
    permissions: ["write"],
  },
  fs_delete_file: { riskLevel: "dangerous", permissions: ["delete"] },
  browser_open_url: { riskLevel: "safe", permissions: ["read"] },
  browser_get_text: { riskLevel: "safe", permissions: ["read"] },
  browser_get_links: { riskLevel: "safe", permissions: ["read"] },
  browser_screenshot: { riskLevel: "safe", permissions: ["read"] },
  browser_click: {
    riskLevel: "confirm_required",
    permissions: ["execute"],
  },
  browser_type: {
    riskLevel: "confirm_required",
    permissions: ["execute"],
  },
  browser_submit: {
    riskLevel: "confirm_required",
    permissions: ["execute"],
  },
  browser_reset_session: {
    riskLevel: "confirm_required",
    permissions: ["execute"],
  },
  browser_close_session: {
    riskLevel: "confirm_required",
    permissions: ["execute"],
  },
  github_search_repo: { riskLevel: "safe", permissions: ["read"] },
  github_read_file: { riskLevel: "safe", permissions: ["read"] },
  github_list_issues: { riskLevel: "safe", permissions: ["read"] },
  github_create_issue: { riskLevel: "dangerous", permissions: ["write"] },
  github_create_pr: { riskLevel: "dangerous", permissions: ["write"] },
} as const satisfies Record<string, McpToolSecurityMetadata>;

export type KnownMcpToolName = keyof typeof MCP_TOOL_SECURITY;

export function getMcpToolSecurityMetadata(
  toolName: string
): McpToolSecurityMetadata | undefined {
  return MCP_TOOL_SECURITY[toolName as KnownMcpToolName];
}
