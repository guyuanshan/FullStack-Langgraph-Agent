import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod"; // 这是一个用于定义和验证数据结构的库，我们用它来定义工具输入的模式

const workspaceRoot = process.env.MCP_WORKSPACE_ROOT
  ? path.resolve(process.env.MCP_WORKSPACE_ROOT)
  : process.cwd();// 定义工作区根目录，优先使用环境变量 MCP_WORKSPACE_ROOT，如果没有设置则使用当前工作目录

const server = new McpServer({ // 创建一个 MCP 服务器实例
  name: "filesystem-mcp-server",
  version: "1.0.0",
});

function resolveWorkspacePath(inputPath) { // 定义一个函数来解析工作区内的路径，确保所有操作都限制在工作区根目录内
  const normalized = inputPath.trim();

  if (!normalized) {
    throw new Error("Path cannot be empty");
  }

  if (path.isAbsolute(normalized)) {
    throw new Error("Path must be workspace-relative");
  }

  const candidate = path.resolve(workspaceRoot, normalized);

  if (
    candidate !== workspaceRoot &&
    !candidate.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error("Path must stay inside the workspace root");
  }

  return candidate;
}

const FORBIDDEN_PATHS = new Set([
  ".env",
  ".env.local",
  ".env.production",
]); // 定义一个禁止访问的路径集合，包含一些常见的环境变量文件，这些文件可能包含敏感信息，因此不允许通过工具访问

function assertAllowedWorkspacePath(inputPath) {
  const normalized = (inputPath ?? ".").trim();

  if (FORBIDDEN_PATHS.has(normalized)) {
    throw new Error("Access to sensitive files is not allowed");
  }

  return resolveWorkspacePath(normalized);
}

async function walkDirectory(directory, entries = []) { // 定义一个函数来递归遍历目录，收集所有文件的绝对路径，返回一个包含所有文件路径的数组
  const items = await readdir(directory, { withFileTypes: true });

  for (const item of items) {
    if (item.name === "node_modules" || item.name === ".git") {
      continue;
    }

    const fullPath = path.join(directory, item.name);

    if (item.isDirectory()) {
      await walkDirectory(fullPath, entries);
      continue;
    }

    if (item.isFile()) {
      entries.push(fullPath);
    }
  }

  return entries;
}

server.registerTool(
  "fs_read_text",
  {
    description: "Read a UTF-8 text file inside the workspace.",
    annotations: { // 这个工具的注释中包含一个 readOnlyHint，提示使用者这个工具是只读的，不会修改文件系统
      readOnlyHint: true,
    },
    inputSchema: { // 定义工具输入的模式，要求输入一个字符串类型的 filePath，表示要读取的文件在工作区内的相对路径
      filePath: z.string().describe("Workspace-relative path to a text file"),
    },
  },
  async ({ filePath }) => {
    const targetPath = assertAllowedWorkspacePath(filePath);
    const content = await readFile(targetPath, "utf8"); // 读取指定路径的文件内容，使用 UTF-8 编码

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              filePath,
              content,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        filePath,
        content,
      },
    };
  }
);

server.registerTool(
  "fs_list_dir",
  {
    description: "List files and directories inside a workspace directory.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      directory: z
        .string()
        .optional()
        .describe("Optional workspace-relative directory to inspect"),
    },
  },
  async ({ directory }) => {
    const targetPath = assertAllowedWorkspacePath(directory ?? ".");
    const items = await readdir(targetPath, { withFileTypes: true });
    const entries = items
      .filter((item) => item.name !== "node_modules" && item.name !== ".git")
      .map((item) => ({
        name: item.name,
        type: item.isDirectory() ? "directory" : "file",
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              directory: directory ?? ".",
              entries,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        directory: directory ?? ".",
        entries,
      },
    };
  }
);

server.registerTool(
  "fs_search_files",
  {
    description:
      "Search workspace files by filename or file content substring.", // 这个工具的描述说明它可以通过文件名或文件内容的子字符串来搜索工作区内的文件
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      query: z.string().describe("Substring to search for"),
      directory: z
        .string()
        .optional()
        .describe("Optional workspace-relative directory to search in"),
    },
  },
  async ({ query, directory }) => { // 这个工具的实现首先解析要搜索的目录，如果没有指定则默认为工作区根目录，然后递归遍历目录中的所有文件，检查每个文件的相对路径和内容是否包含查询字符串，如果匹配则将相对路径添加到结果中，最后返回匹配的文件列表
    const baseDir = assertAllowedWorkspacePath(directory ?? ".");
    const files = await walkDirectory(baseDir);
    const matches = [];

    for (const fullPath of files) {
      const relativePath = path.relative(workspaceRoot, fullPath);

      if (relativePath.includes(query)) {
        matches.push(relativePath);
        continue; // 如果文件的相对路径包含查询字符串，则直接添加到结果中并跳过内容检查，以提高效率
      }

      try {
        const content = await readFile(fullPath, "utf8");

        if (content.includes(query)) {
          matches.push(relativePath);
        }
      } catch {
        // Ignore non-text or unreadable files during broad search.
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              directory: directory ?? ".",
              matches,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        query,
        directory: directory ?? ".",
        matches,
      },
    };
  }
);

server.registerTool( 
  "fs_write_text",
  {
    description: "Write a UTF-8 text file inside the workspace.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      filePath: z.string().describe("Workspace-relative path to write"),
      content: z.string().describe("UTF-8 content to write"),
    },
  },
  async ({ filePath, content }) => {
    const targetPath = assertAllowedWorkspacePath(filePath);
    const parent = path.dirname(targetPath);

    await mkdir(parent, { recursive: true });
    await writeFile(targetPath, content, "utf8");
    const fileStat = await stat(targetPath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              filePath,
              bytes: fileStat.size,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        filePath,
        bytes: fileStat.size,
      },
    };
  }
);

server.registerTool(
  "fs_delete_file",
  {
    description: "Delete a file inside the workspace.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      filePath: z.string().describe("Workspace-relative file path to delete"),
    },
  },
  async ({ filePath }) => {
    const targetPath = assertAllowedWorkspacePath(filePath);
    await rm(targetPath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              filePath,
              deleted: true,
            },
            null,
            2
          ),
        },
      ],
      structuredContent: {
        filePath,
        deleted: true,
      },
    };
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);
