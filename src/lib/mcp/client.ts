import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ProviderToolDefinition } from "../ai/providers/types";
import type {
  ToolArgs,
  ToolDefinition,
  ToolPermission,
  ToolParameters,
  ToolRiskLevel,
} from "../tools/types";

type McpToolDefinition = ToolDefinition & {
  executeViaMcp: true;
};

type McpServerConfig = {
  id: string;
  entrypoint: string;
  env?: Record<string, string>;
};

const serverConfigs: McpServerConfig[] = [
  {
    id: "filesystem",
    entrypoint: "filesystem-server.mjs",
    env: {
      MCP_WORKSPACE_ROOT: process.cwd(),
    },
  },
  {
    id: "github",
    entrypoint: "github-server.mjs",
  },
  {
    id: "browser",
    entrypoint: "browser-server.mjs",
  },
];

const clientPromises = new Map<string, Promise<Client>>();
let cachedToolsPromise: Promise<McpToolDefinition[]> | null = null;

function getServerPath(entrypoint: string) {
  return path.join(process.cwd(), "src/lib/mcp", entrypoint);
}

async function getMcpClient(serverConfig: McpServerConfig) {
  const existingClientPromise = clientPromises.get(serverConfig.id);

  if (existingClientPromise) {
    return existingClientPromise;
  }

  const clientPromise = (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [getServerPath(serverConfig.entrypoint)],
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...serverConfig.env,
      } as Record<string, string>,
    });
    const client = new Client(
      {
        name: `fullstack-langgraph-agent-${serverConfig.id}`,
        version: "0.1.0",
      },
      {}
    );

    await client.connect(transport);
    return client;
  })();

  clientPromises.set(serverConfig.id, clientPromise);
  return clientPromise;
}

function toToolRiskLevel(name: string): ToolRiskLevel {
  if (name.startsWith("fs_delete")) {
    return "dangerous";
  }

  if (
    name.startsWith("fs_write") ||
    name.startsWith("browser_click") ||
    name.startsWith("browser_type") ||
    name.startsWith("browser_submit") ||
    name.startsWith("browser_reset") ||
    name.startsWith("browser_close") ||
    name.startsWith("github_create") ||
    name.startsWith("github_comment") ||
    name.startsWith("github_pr")
  ) {
    return "confirm_required";
  }

  return "safe";
}

function toToolPermissions(name: string): ToolPermission[] {
  if (
    name.startsWith("fs_read") ||
    name.startsWith("fs_search") ||
    name.startsWith("fs_list") ||
    name.startsWith("browser_open") ||
    name.startsWith("browser_get") ||
    name.startsWith("browser_screenshot") ||
    name.startsWith("github_search") ||
    name.startsWith("github_read") ||
    name.startsWith("github_list")
  ) {
    return ["read"];
  }

  if (
    name.startsWith("fs_write") ||
    name.startsWith("github_create") ||
    name.startsWith("github_comment") ||
    name.startsWith("github_pr")
  ) {
    return ["write"];
  }

  if (
    name.startsWith("browser_click") ||
    name.startsWith("browser_type") ||
    name.startsWith("browser_submit") ||
    name.startsWith("browser_reset") ||
    name.startsWith("browser_close")
  ) {
    return ["execute"];
  }

  if (name.startsWith("fs_delete")) {
    return ["delete"];
  }

  return [];
}

function toProviderToolDefinition(tool: ToolDefinition): ProviderToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toToolParameters(inputSchema: {
  [x: string]: unknown;
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
}): ToolParameters {
  return {
    ...inputSchema,
    type: "object",
    properties: inputSchema.properties ?? {},
    required: inputSchema.required,
  };
}

function hasStructuredContent(
  result: unknown
): result is { structuredContent: Record<string, unknown> } {
  return (
    !!result &&
    typeof result === "object" &&
    "structuredContent" in result &&
    !!result.structuredContent
  );
}

function hasToolResult(result: unknown): result is { toolResult: unknown } {
  return !!result && typeof result === "object" && "toolResult" in result;
}

function hasContent(result: unknown): result is {
  content: Array<
    | { type: "text"; text: string }
    | { type: "resource"; resource: unknown }
    | { type: string }
  >;
} {
  return (
    !!result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray(result.content)
  );
}

function normalizeMcpResult(result: unknown) {
  if (hasStructuredContent(result)) {
    return result.structuredContent;
  }

  if (hasToolResult(result)) {
    return result.toolResult;
  }

  if (!hasContent(result)) {
    return result;
  }

  return result.content.map((item) => {
    if (item.type === "text" && "text" in item) {
      try {
        return JSON.parse(item.text);
      } catch {
        return item.text;
      }
    }

    if (item.type === "resource" && "resource" in item) {
      return item.resource;
    }

    return item;
  });
}

async function callMcpTool(
  clientPromise: Promise<Client>,
  name: string,
  args: ToolArgs
) {
  const client = await clientPromise;
  const result = await client.callTool({
    name,
    arguments: args,
  });

  if (result.isError) {
    const message = hasContent(result)
      ? result.content
          .map((item) =>
            item.type === "text" && "text" in item ? item.text : item.type
          )
          .join("\n")
          .trim()
      : "";

    throw new Error(message || `MCP tool ${name} failed`);
  }

  return normalizeMcpResult(result);
}

export async function getMcpTools(): Promise<McpToolDefinition[]> {
  if (!cachedToolsPromise) {
    cachedToolsPromise = (async () => {
      const toolGroups = await Promise.all(
        serverConfigs.map(async (serverConfig) => {
          const clientPromise = getMcpClient(serverConfig);
          const client = await clientPromise;
          const result = await client.listTools();

          return result.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
            parameters: toToolParameters(tool.inputSchema),
            source: "mcp" as const,
            riskLevel: toToolRiskLevel(tool.name),
            permissions: toToolPermissions(tool.name),
            executeViaMcp: true as const,
            execute: async (args: ToolArgs) =>
              callMcpTool(clientPromise, tool.name, args),
          }));
        })
      );

      return toolGroups.flat();
    })();
  }

  return cachedToolsPromise;
}

export async function getMcpProviderTools() {
  const tools = await getMcpTools();
  return tools.map(toProviderToolDefinition);
}
