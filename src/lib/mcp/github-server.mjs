import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "github-mcp-server",
  version: "1.0.0",
});

const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
const defaultRepo = process.env.GITHUB_DEFAULT_REPO?.trim() || null;
const githubToken = process.env.GITHUB_TOKEN?.trim() || null;

function normalizeRepo(inputRepo) {
  // normalizeRepo 函数用于验证和规范化 GitHub 仓库的输入格式。
  // 它接受一个输入字符串 inputRepo，首先进行修剪（去除前后空格），
  // 然后检查是否符合 "owner/name" 的格式要求。如果输入不符合要求，函数会抛出相应的错误提示。
  // 最终返回规范化后的仓库名称。
  const repo = (inputRepo ?? defaultRepo ?? "").trim();

  if (!repo) {
    throw new Error("A GitHub repo like owner/name is required");
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Repo must match owner/name");
  }

  return repo;
}

async function fetchGitHubJson(pathname, init = {}, requireAuth = false) {
  // fetchGitHubJson 函数是一个通用的工具函数，用于向 GitHub API 发送请求并获取 JSON 格式的响应。
  // 它接受三个参数：pathname（API 路径），init（fetch 请求的初始化选项），requireAuth（一个布尔值，指示是否需要身份验证）。
  // 函数首先检查是否需要身份验证且没有提供 GitHub 令牌，如果是，则抛出错误。
  // 然后构建完整的 API URL，并设置必要的请求头，包括接受 JSON 响应和用户代理信息。
  // 如果提供了 GitHub 令牌，还会在请求头中添加授权信息。
  // 最后，函数发送请求并处理响应，如果响应状态不成功，则抛出错误；否则返回解析后的 JSON 数据。
  if (requireAuth && !githubToken) {
    throw new Error("GITHUB_TOKEN is required for this GitHub write operation");
  }

  const url = new URL(pathname, apiBaseUrl);
  const headers = new Headers(init.headers ?? {});

  headers.set("Accept", "application/vnd.github+json");
  headers.set("User-Agent", "fullstack-langgraph-agent");

  if (githubToken) {
    headers.set("Authorization", `Bearer ${githubToken}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      data && typeof data.message === "string"
        ? data.message
        : `GitHub API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function makeTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function decodeFileContent(item) {
  // decodeFileContent 函数用于解码 GitHub API 返回的文件内容。
  // GitHub API 通常会以 base64 编码的形式返回文件内容，
  // 因此这个函数首先检查返回的数据是否包含 content 字段且编码方式为 base64。
  if (typeof item.content !== "string" || item.encoding !== "base64") {
    return null;
  }

  return Buffer.from(item.content, "base64").toString("utf8");
}

server.registerTool(
  "github_search_repo",
  {
    description: "Search GitHub repositories or inspect a repo by owner/name.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      query: z
        .string()
        .describe("Repository search query or an exact owner/name repo"),
      limit: z.number().int().min(1).max(10).optional(),
    },
  },
  async ({ query, limit = 5 }) => {
    const trimmedQuery = query.trim();

    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmedQuery)) {
      const repo = normalizeRepo(trimmedQuery);
      const details = await fetchGitHubJson(`/repos/${repo}`);

      return makeTextResult({
        query: trimmedQuery,
        repositories: [
          {
            fullName: details.full_name,
            description: details.description,
            defaultBranch: details.default_branch,
            stars: details.stargazers_count,
            openIssues: details.open_issues_count,
            htmlUrl: details.html_url,
            updatedAt: details.updated_at,
          },
        ],
      });
    }

    const searchUrl = new URL("/search/repositories", apiBaseUrl);
    searchUrl.searchParams.set("q", trimmedQuery);
    searchUrl.searchParams.set("per_page", String(limit));

    const result = await fetchGitHubJson(searchUrl.pathname + searchUrl.search);

    return makeTextResult({
      query: trimmedQuery,
      repositories: Array.isArray(result.items)
        ? result.items.map((item) => ({
            fullName: item.full_name,
            description: item.description,
            stars: item.stargazers_count,
            updatedAt: item.updated_at,
            htmlUrl: item.html_url,
            defaultBranch: item.default_branch,
          }))
        : [],
    });
  }
);

server.registerTool(
  "github_read_file",
  {
    description:
      "Read a GitHub file or list directory contents inside a GitHub repository.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      repo: z.string().describe("GitHub repo in owner/name format"),
      path: z
        .string()
        .optional()
        .describe("File or directory path inside the repo. Omit for repo root"),
      ref: z
        .string()
        .optional()
        .describe("Optional branch, tag, or commit SHA"),
    },
  },
  async ({ repo: inputRepo, path = "", ref }) => {
    const repo = normalizeRepo(inputRepo);
    const normalizedPath = path.trim().replace(/^\/+/, "");
    const endpoint = new URL(
      `/repos/${repo}/contents/${normalizedPath}`,
      apiBaseUrl
    );

    if (ref?.trim()) {
      endpoint.searchParams.set("ref", ref.trim());
    }

    const result = await fetchGitHubJson(endpoint.pathname + endpoint.search);

    if (Array.isArray(result)) {
      return makeTextResult({
        repo,
        path: normalizedPath || ".",
        ref: ref?.trim() || null,
        type: "directory",
        entries: result.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size,
          htmlUrl: item.html_url,
        })),
        htmlUrl: result[0]?.html_url
          ? result[0].html_url.replace(/\/[^/]+$/, "")
          : `https://github.com/${repo}/tree/${ref?.trim() || "HEAD"}/${normalizedPath}`.replace(/\/$/, ""),
      });
    }

    return makeTextResult({
      repo,
      path: result.path,
      ref: ref?.trim() || null,
      type: result.type,
      size: result.size,
      htmlUrl: result.html_url,
      content: decodeFileContent(result),
    });
  }
);

server.registerTool(
  "github_list_issues",
  {
    description: "List recent issues from a GitHub repository.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      repo: z.string().describe("GitHub repo in owner/name format"),
      state: z.enum(["open", "closed", "all"]).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
  },
  async ({ repo: inputRepo, state = "open", limit = 10 }) => {
    const repo = normalizeRepo(inputRepo);
    const endpoint = new URL(`/repos/${repo}/issues`, apiBaseUrl);

    endpoint.searchParams.set("state", state);
    endpoint.searchParams.set("per_page", String(Math.min(limit * 3, 50)));

    const issues = await fetchGitHubJson(endpoint.pathname + endpoint.search);
    const normalizedIssues = Array.isArray(issues)
      ? issues
          .filter((item) => !item.pull_request)
          .slice(0, limit)
      : [];

    return makeTextResult({
      repo,
      state,
      issues: normalizedIssues.map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        author: item.user?.login ?? null,
        comments: item.comments,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        htmlUrl: item.html_url,
      })),
    });
  }
);

server.registerTool(
  "github_create_issue",
  {
    description: "Create a new GitHub issue in a repository.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      repo: z.string().describe("GitHub repo in owner/name format"),
      title: z.string().describe("Issue title"),
      body: z.string().optional().describe("Issue body in Markdown"),
    },
  },
  async ({ repo: inputRepo, title, body }) => {
    const repo = normalizeRepo(inputRepo);
    const issue = await fetchGitHubJson(
      `/repos/${repo}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          body,
        }),
      },
      true
    );

    return makeTextResult({
      repo,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      htmlUrl: issue.html_url,
      url: issue.html_url,
    });
  }
);

server.registerTool(
  "github_create_pr",
  {
    description: "Create a new GitHub pull request in a repository.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      repo: z.string().describe("GitHub repo in owner/name format"),
      title: z.string().describe("Pull request title"),
      head: z
        .string()
        .describe("Head branch name, for example codex/my-change"),
      base: z.string().optional().describe("Base branch, defaults to repo default branch"),
      body: z.string().optional().describe("Pull request body in Markdown"),
      draft: z.boolean().optional().describe("Whether to create a draft PR"),
    },
  },
  async ({ repo: inputRepo, title, head, base, body, draft = false }) => {
    const repo = normalizeRepo(inputRepo);
    const pullRequest = await fetchGitHubJson(
      `/repos/${repo}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          head,
          base,
          body,
          draft,
        }),
      },
      true
    );

    return makeTextResult({
      repo,
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      draft: pullRequest.draft,
      htmlUrl: pullRequest.html_url,
      url: pullRequest.html_url,
      head: pullRequest.head?.ref ?? head,
      base: pullRequest.base?.ref ?? base ?? null,
    });
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);
