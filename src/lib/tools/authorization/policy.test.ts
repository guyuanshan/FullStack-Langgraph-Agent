import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { AuthContext } from "../../auth/tenant-resolution";
import {
  MCP_TOOL_SECURITY,
  type KnownMcpToolName,
} from "../../mcp/tool-security";
import { getLocalRegisteredTools } from "../index";
import type {
  ToolArgs,
  ToolPermission,
  ToolRiskLevel,
} from "../types";
import {
  decideToolPolicy,
  evaluateToolAuthorization,
} from "./policy";
import { resolveToolRiskLevel } from "../policy";

const auth: AuthContext = Object.freeze({
  userId: "policy-user",
  tenantId: "policy-tenant",
  role: "member",
});

function decide(input: {
  toolName: string;
  args?: ToolArgs;
  source?: "local" | "mcp";
  permissions?: ToolPermission[];
  riskLevel?: ToolRiskLevel;
  registered?: boolean;
}) {
  return decideToolPolicy({
    auth,
    sessionId: "policy-session",
    toolName: input.toolName,
    args: input.args ?? {},
    source: input.source ?? "local",
    permissions: input.permissions ?? ["read"],
    riskLevel: input.riskLevel,
    registered: input.registered ?? true,
  });
}

function expectedAction(riskLevel: ToolRiskLevel) {
  return riskLevel === "safe" ? "allow" : "require_approval";
}

function readRegisteredMcpToolNames() {
  return [
    "filesystem-server.mjs",
    "github-server.mjs",
    "browser-server.mjs",
  ].flatMap((fileName) => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/mcp", fileName),
      "utf8"
    );

    return [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(
      (match) => match[1]
    );
  });
}

function resolveMcpRisk(toolName: KnownMcpToolName, args: ToolArgs) {
  const metadata = MCP_TOOL_SECURITY[toolName];

  return resolveToolRiskLevel(
    {
      name: toolName,
      description: "",
      source: "mcp",
      riskLevel: metadata.riskLevel,
      permissions: [...metadata.permissions],
      parameters: {
        type: "object",
        properties: {},
      },
      async execute() {
        return null;
      },
    },
    args
  );
}

const mcpArgs: Record<KnownMcpToolName, ToolArgs> = {
  fs_read_text: { filePath: "src/app/page.tsx" },
  fs_list_dir: { directory: "src" },
  fs_search_files: { query: "ToolCall", directory: "src" },
  fs_write_text: {
    filePath: ".demo-output/policy.txt",
    content: "policy",
  },
  fs_delete_file: { filePath: ".demo-output/policy.txt" },
  browser_open_url: { url: "https://example.com" },
  browser_get_text: { selector: "main" },
  browser_get_links: { selector: "main" },
  browser_screenshot: { selector: "main" },
  browser_click: { url: "https://example.com", selector: "#next" },
  browser_type: {
    url: "https://example.com",
    selector: "#query",
    text: "hello",
  },
  browser_submit: {
    url: "https://example.com",
    selector: "#search-form",
  },
  browser_reset_session: {},
  browser_close_session: {},
  github_search_repo: { query: "openai/codex" },
  github_read_file: { repo: "openai/codex", path: "README.md" },
  github_list_issues: { repo: "openai/codex" },
  github_create_issue: {
    repo: "openai/codex",
    title: "Policy test",
  },
  github_create_pr: {
    repo: "openai/codex",
    title: "Policy test",
    head: "codex/policy-test",
  },
};

describe("unified tool policy", () => {
  it("covers every registered local tool with explicit metadata", () => {
    const tools = getLocalRegisteredTools();

    assert.ok(tools.length > 0);
    for (const tool of tools) {
      assert.ok(tool.riskLevel, `${tool.name} is missing riskLevel`);
      assert.ok(
        tool.permissions?.length,
        `${tool.name} is missing permissions`
      );

      const decision = decide({
        toolName: tool.name,
        source: tool.source,
        permissions: tool.permissions,
        riskLevel: tool.riskLevel,
      });

      assert.equal(
        decision.action,
        expectedAction(tool.riskLevel),
        tool.name
      );
    }
  });

  it("covers every MCP server tool with exact allowlisted metadata", () => {
    const expectedNames = readRegisteredMcpToolNames().sort();

    assert.deepEqual(Object.keys(MCP_TOOL_SECURITY).sort(), expectedNames);

    for (const toolName of Object.keys(
      MCP_TOOL_SECURITY
    ) as KnownMcpToolName[]) {
      const metadata = MCP_TOOL_SECURITY[toolName];
      const decision = decide({
        toolName,
        args: mcpArgs[toolName],
        source: "mcp",
        permissions: [...metadata.permissions],
        riskLevel: metadata.riskLevel,
      });

      assert.equal(
        decision.action,
        expectedAction(metadata.riskLevel),
        toolName
      );
    }
  });

  it("denies unknown tools and incomplete metadata by default", () => {
    assert.equal(
      decide({
        toolName: "unknown_tool",
        registered: false,
      }).action,
      "deny"
    );
    assert.match(
      decide({
        toolName: "missing_risk",
        permissions: ["read"],
      }).reason,
      /missing risk metadata/
    );
    assert.match(
      decide({
        toolName: "missing_permissions",
        permissions: [],
        riskLevel: "safe",
      }).reason,
      /missing permission metadata/
    );
  });

  it("never auto-allows filesystem writes or deletes for any runtime", () => {
    for (const runtime of ["manual", "langgraph", "multi_agent"]) {
      const write = decide({
        toolName: "fs_write_text",
        source: "mcp",
        permissions: ["write"],
        riskLevel: "confirm_required",
        args: mcpArgs.fs_write_text,
      });
      const remove = decide({
        toolName: "fs_delete_file",
        source: "mcp",
        permissions: ["delete"],
        riskLevel: "dangerous",
        args: mcpArgs.fs_delete_file,
      });

      assert.equal(write.action, "require_approval", runtime);
      assert.equal(remove.action, "require_approval", runtime);
      if (remove.action === "require_approval") {
        assert.equal(remove.requiredRole, "admin", runtime);
      }
    }
  });

  it("upgrades Browser risk from actual URL, selector, and input text", () => {
    const publicRead = decide({
      toolName: "browser_open_url",
      source: "mcp",
      permissions: ["read"],
      riskLevel: resolveMcpRisk("browser_open_url", {
        url: "https://example.com/docs",
      }),
      args: { url: "https://example.com/docs" },
    });
    const sensitiveRead = decide({
      toolName: "browser_open_url",
      source: "mcp",
      permissions: ["read"],
      riskLevel: resolveMcpRisk("browser_open_url", {
        url: "https://accounts.google.com/login",
      }),
      args: { url: "https://accounts.google.com/login" },
    });
    const passwordType = decide({
      toolName: "browser_type",
      source: "mcp",
      permissions: ["execute"],
      riskLevel: resolveMcpRisk("browser_type", {
        url: "https://example.com/account",
        selector: "input[type=password]",
        text: "secret value",
      }),
      args: {
        url: "https://example.com/account",
        selector: "input[type=password]",
        text: "secret value",
      },
    });
    const destructiveClick = decide({
      toolName: "browser_click",
      source: "mcp",
      permissions: ["execute"],
      riskLevel: resolveMcpRisk("browser_click", {
        url: "https://example.com/account",
        selector: "#delete-account",
      }),
      args: {
        url: "https://example.com/account",
        selector: "#delete-account",
      },
    });
    const sensitiveDomainClick = decide({
      toolName: "browser_click",
      source: "mcp",
      permissions: ["execute"],
      riskLevel: resolveMcpRisk("browser_click", {
        url: "https://github.com/settings/profile",
        selector: "#save",
      }),
      args: {
        url: "https://github.com/settings/profile",
        selector: "#save",
      },
    });
    const privateUrl = decide({
      toolName: "browser_open_url",
      source: "mcp",
      permissions: ["read"],
      riskLevel: "safe",
      args: { url: "http://127.0.0.1:3000/admin" },
    });

    assert.equal(publicRead.action, "allow");
    assert.equal(sensitiveRead.action, "require_approval");
    assert.equal(passwordType.action, "require_approval");
    assert.equal(destructiveClick.action, "require_approval");
    assert.equal(sensitiveDomainClick.action, "require_approval");
    if (passwordType.action === "require_approval") {
      assert.equal(passwordType.requiredRole, "admin");
    }
    if (sensitiveDomainClick.action === "require_approval") {
      assert.equal(sensitiveDomainClick.requiredRole, "admin");
    }
    assert.equal(privateUrl.action, "deny");
  });

  it("denies sensitive files, cross-tenant args, and invalid Git targets", () => {
    assert.equal(
      decide({
        toolName: "fs_read_text",
        source: "mcp",
        permissions: ["read"],
        riskLevel: "safe",
        args: { filePath: ".env.production" },
      }).action,
      "deny"
    );
    assert.equal(
      decide({
        toolName: "project_read_files",
        permissions: ["read"],
        riskLevel: "safe",
        args: { paths: ["secrets/api-key.txt"] },
      }).action,
      "deny"
    );
    assert.equal(
      decide({
        toolName: "project_memory_search",
        permissions: ["read"],
        riskLevel: "safe",
        args: { query: "hello", tenantId: "another-tenant" },
      }).action,
      "deny"
    );
    assert.equal(
      decide({
        toolName: "git_push_branch",
        permissions: ["execute"],
        riskLevel: "dangerous",
        args: { remote: "--upload-pack=evil", branchName: "main" },
      }).action,
      "deny"
    );
  });

  it("shows repository, remote, and branch for Git push approval", async () => {
    const authorization = await evaluateToolAuthorization({
      auth,
      sessionId: "policy-session",
      toolName: "git_push_branch",
      args: {
        remote: "origin",
        branchName: "codex/policy-test",
      },
    });

    assert.equal(authorization.decision.action, "require_approval");
    assert.equal(authorization.decision.riskLevel, "dangerous");
    assert.match(authorization.summary ?? "", /repository=https:\/\/github\.com\//);
    assert.match(authorization.summary ?? "", /remote=origin/);
    assert.match(authorization.summary ?? "", /branch=codex\/policy-test/);
  });
});
