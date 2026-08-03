import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDefaultFileSandboxContext,
  deleteFile,
  listDirectory,
  readText,
  searchFiles,
  writeText,
} from "../file-sandbox/core.mjs";

const server = new McpServer({
  name: "filesystem-mcp-server",
  version: "1.0.0",
});

async function getContext(access) {
  return createDefaultFileSandboxContext({ access });
}

function toToolError(error) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "Filesystem operation failed";

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

server.registerTool(
  "fs_read_text",
  {
    description: "Read a UTF-8 text file inside the workspace.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      filePath: z.string().describe("Workspace-relative path to a text file"),
    },
  },
  async ({ filePath }) => {
    try {
      const context = await getContext("read");
      const result = await readText(context, filePath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filePath: result.path,
                content: result.content,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          filePath: result.path,
          content: result.content,
        },
      };
    } catch (error) {
      return toToolError(error);
    }
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
    try {
      const context = await getContext("read");
      const result = await listDirectory(context, directory ?? ".");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                directory: result.directory,
                entries: result.entries,
                truncated: result.truncated,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          directory: result.directory,
          entries: result.entries,
          truncated: result.truncated,
        },
      };
    } catch (error) {
      return toToolError(error);
    }
  }
);

server.registerTool(
  "fs_search_files",
  {
    description:
      "Search workspace files by filename or file content substring.",
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
  async ({ query, directory }) => {
    try {
      const context = await getContext("read");
      const result = await searchFiles(context, {
        query,
        directory: directory ?? ".",
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: result.query,
                directory: result.directory,
                matches: result.matches,
                truncated: result.truncated,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          query: result.query,
          directory: result.directory,
          matches: result.matches,
          truncated: result.truncated,
        },
      };
    } catch (error) {
      return toToolError(error);
    }
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
    try {
      const context = await getContext("write");
      const result = await writeText(context, filePath, content);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filePath: result.path,
                bytes: result.bytes,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          filePath: result.path,
          bytes: result.bytes,
        },
      };
    } catch (error) {
      return toToolError(error);
    }
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
    try {
      const context = await getContext("delete");
      const result = await deleteFile(context, filePath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filePath: result.path,
                deleted: result.deleted,
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          filePath: result.path,
          deleted: result.deleted,
        },
      };
    } catch (error) {
      return toToolError(error);
    }
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);
