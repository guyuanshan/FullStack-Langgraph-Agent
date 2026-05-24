import {
  buildProjectSummary,
} from "../code-agent/project";
import { searchProjectCode } from "../code-agent/search";
import { readProjectFiles } from "../code-agent/read";
import { createPatchProposal } from "../code-agent/proposals";
import { runProjectChecks } from "../code-agent/commands";
import {
  buildPullRequestSummary,
  createGitBranch,
  createGitCommit,
  getGitStatusSummary,
  pushGitBranch,
} from "../code-agent/git";
import {
  indexProjectMemory,
  refreshProjectMemory,
  retrieveProjectMemories,
} from "../project-memory";
import type { ToolDefinition } from "./types";

export const projectSummaryTool: ToolDefinition = {
  name: "project_index_summary",
  description:
    "Scan the project structure, inspect package.json, tsconfig.json, and README.md, detect the tech stack, and return a compact project summary.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    return buildProjectSummary();
  },
};

export const projectSearchTool: ToolDefinition = {
  name: "project_search",
  description:
    "Search the codebase by file name, keyword, symbol, or general query. Use this to locate functions, components, routes, and relevant files.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search term, symbol name, or file name fragment",
      },
      mode: {
        type: "string",
        enum: ["auto", "filename", "content", "symbol", "semantic"],
        description: "Search strategy",
      },
      directory: {
        type: "string",
        description: "Optional relative directory to search inside",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of matches to return",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const query = args.query;

    if (typeof query !== "string") {
      throw new Error("Tool project_search requires a string query");
    }

    return searchProjectCode({
      query,
      mode:
        typeof args.mode === "string" &&
        ["auto", "filename", "content", "symbol", "semantic"].includes(args.mode)
          ? (args.mode as "auto" | "filename" | "content" | "symbol" | "semantic")
          : "auto",
      directory: typeof args.directory === "string" ? args.directory : undefined,
      maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
    });
  },
};

export const projectReadFilesTool: ToolDefinition = {
  name: "project_read_files",
  description:
    "Read a selected set of project files and return compact file contents for LLM context assembly.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Relative file paths to read",
      },
      maxCharsPerFile: {
        type: "number",
        description: "Maximum characters to return per file",
      },
    },
    required: ["paths"],
  },
  async execute(args) {
    return readProjectFiles({
      paths: Array.isArray(args.paths) ? (args.paths as string[]) : [],
      maxCharsPerFile:
        typeof args.maxCharsPerFile === "number" ? args.maxCharsPerFile : undefined,
    });
  },
};

export const projectMemoryIndexTool: ToolDefinition = {
  name: "project_memory_index",
  description:
    "Scan the current project, chunk important files and docs, generate embeddings, and persist project-level memory for future retrieval.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      embeddingProvider: {
        type: "string",
        enum: ["local", "openai", "gemini"],
        description: "Optional embedding backend override",
      },
    },
  },
  async execute(args) {
    const onProgress =
      typeof args.__progress === "function"
        ? (args.__progress as (event: {
            phase: "scanning" | "embedding";
            completed: number;
            total: number;
            chunkKey?: string;
            sourcePath?: string | null;
          }) => void)
        : undefined;

    return indexProjectMemory({
      embeddingProvider:
        typeof args.embeddingProvider === "string"
          ? args.embeddingProvider
          : undefined,
      onProgress,
    });
  },
};

export const projectMemorySearchTool: ToolDefinition = {
  name: "project_memory_search",
  description:
    "Search project-level long-term memory using semantic similarity. Useful for tech stack, architecture, prior fixes, and related code chunks.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Question or retrieval query",
      },
      topK: {
        type: "number",
        description: "Maximum number of memories to return",
      },
      embeddingProvider: {
        type: "string",
        enum: ["local", "openai", "gemini"],
        description: "Optional embedding backend override",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    if (typeof args.query !== "string") {
      throw new Error("Tool project_memory_search requires a string query");
    }

    return retrieveProjectMemories({
      query: args.query,
      topK: typeof args.topK === "number" ? args.topK : undefined,
      embeddingProvider:
        typeof args.embeddingProvider === "string"
          ? args.embeddingProvider
          : undefined,
    });
  },
};

export const projectMemoryRefreshTool: ToolDefinition = {
  name: "project_memory_refresh",
  description:
    "Refresh project memory for a specific set of changed files after edits, replacing old embeddings for those paths.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Relative file paths to re-index",
      },
      embeddingProvider: {
        type: "string",
        enum: ["local", "openai", "gemini"],
        description: "Optional embedding backend override",
      },
    },
    required: ["paths"],
  },
  async execute(args) {
    const onProgress =
      typeof args.__progress === "function"
        ? (args.__progress as (event: {
            phase: "scanning" | "embedding";
            completed: number;
            total: number;
            chunkKey?: string;
            sourcePath?: string | null;
          }) => void)
        : undefined;

    return refreshProjectMemory({
      paths: Array.isArray(args.paths) ? (args.paths as string[]) : [],
      embeddingProvider:
        typeof args.embeddingProvider === "string"
          ? args.embeddingProvider
          : undefined,
      onProgress,
    });
  },
};

export const codeProposePatchTool: ToolDefinition = {
  name: "code_propose_patch",
  description:
    "Create a code patch proposal without writing files. Provide full new file content for each file to change, and the tool will return a diff preview proposal for user review.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short patch title",
      },
      summary: {
        type: "string",
        description: "What the patch changes and why",
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative file path to modify",
            },
            content: {
              type: "string",
              description: "Complete new file content after the change",
            },
          },
          required: ["path", "content"],
        },
        description: "Files to include in the patch proposal",
      },
      agentSessionId: {
        type: "string",
        description: "Internal session id injected by runtime",
      },
    },
    required: ["title", "files"],
  },
  async execute(args) {
    if (typeof args.title !== "string") {
      throw new Error("Tool code_propose_patch requires a string title");
    }

    const files = Array.isArray(args.files)
      ? args.files.filter(
          (file): file is { path: string; content: string } =>
            !!file &&
            typeof file === "object" &&
            typeof (file as Record<string, unknown>).path === "string" &&
            typeof (file as Record<string, unknown>).content === "string"
        )
      : [];

    return createPatchProposal({
      sessionId:
        typeof args.agentSessionId === "string" ? args.agentSessionId : null,
      title: args.title,
      summary: typeof args.summary === "string" ? args.summary : undefined,
      files,
    });
  },
};

export const runProjectChecksTool: ToolDefinition = {
  name: "run_project_checks",
  description:
    "Run project lint, typecheck, or tests and capture stdout and stderr for debugging and repair loops.",
  source: "local",
  riskLevel: "confirm_required",
  permissions: ["execute"],
  parameters: {
    type: "object",
    properties: {
      checks: {
        type: "array",
        items: {
          type: "string",
          enum: ["lint", "typecheck", "test"],
        },
        description: "Checks to run in the project",
      },
    },
    required: ["checks"],
  },
  async execute(args) {
    return runProjectChecks({
      checks: Array.isArray(args.checks)
        ? (args.checks.filter((value): value is "lint" | "typecheck" | "test" =>
            value === "lint" || value === "typecheck" || value === "test"
          ) as Array<"lint" | "typecheck" | "test">)
        : [],
    });
  },
};

export const gitStatusSummaryTool: ToolDefinition = {
  name: "git_status_summary",
  description:
    "Inspect the current git branch, changed files, and diff stat for the local project.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    return getGitStatusSummary();
  },
};

export const gitCreateBranchTool: ToolDefinition = {
  name: "git_create_branch",
  description:
    "Create and switch to a new git branch. Prefer branch names with the codex/ prefix for agent-generated work.",
  source: "local",
  riskLevel: "confirm_required",
  permissions: ["execute"],
  parameters: {
    type: "object",
    properties: {
      branchName: {
        type: "string",
        description: "New branch name, for example codex/fix-tool-card",
      },
      fromRef: {
        type: "string",
        description: "Optional base ref to branch from",
      },
    },
    required: ["branchName"],
  },
  async execute(args) {
    if (typeof args.branchName !== "string") {
      throw new Error("Tool git_create_branch requires a string branchName");
    }

    return createGitBranch({
      branchName: args.branchName,
      fromRef: typeof args.fromRef === "string" ? args.fromRef : undefined,
    });
  },
};

export const gitCommitChangesTool: ToolDefinition = {
  name: "git_commit_changes",
  description:
    "Create a git commit. For safety, pass the specific file paths to stage before commit, or pre-stage the intended changes yourself.",
  source: "local",
  riskLevel: "confirm_required",
  permissions: ["write", "execute"],
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Commit message",
      },
      paths: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Optional relative paths to stage before commit",
      },
    },
    required: ["message"],
  },
  async execute(args) {
    if (typeof args.message !== "string") {
      throw new Error("Tool git_commit_changes requires a string message");
    }

    return createGitCommit({
      message: args.message,
      paths: Array.isArray(args.paths) ? (args.paths as string[]) : undefined,
    });
  },
};

export const gitPushBranchTool: ToolDefinition = {
  name: "git_push_branch",
  description:
    "Push the current or specified branch to a remote and set upstream tracking.",
  source: "local",
  riskLevel: "confirm_required",
  permissions: ["execute"],
  parameters: {
    type: "object",
    properties: {
      remote: {
        type: "string",
        description: "Remote name, defaults to origin",
      },
      branchName: {
        type: "string",
        description: "Branch name to push, defaults to current branch",
      },
    },
  },
  async execute(args) {
    return pushGitBranch({
      remote: typeof args.remote === "string" ? args.remote : undefined,
      branchName:
        typeof args.branchName === "string" ? args.branchName : undefined,
    });
  },
};

export const gitPreparePrSummaryTool: ToolDefinition = {
  name: "git_prepare_pr_summary",
  description:
    "Summarize the current branch diff and commits compared to a base branch, and suggest a PR title/body.",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      baseRef: {
        type: "string",
        description: "Base branch or ref, defaults to main",
      },
    },
  },
  async execute(args) {
    return buildPullRequestSummary({
      baseRef: typeof args.baseRef === "string" ? args.baseRef : undefined,
    });
  },
};
