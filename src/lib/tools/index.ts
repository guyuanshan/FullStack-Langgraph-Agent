import { weatherTool } from "./weather";
import { writeDemoFileTool } from "./write-demo-file";
import {
  codeProposePatchTool,
  gitCommitChangesTool,
  gitCreateBranchTool,
  gitPreparePrSummaryTool,
  gitPushBranchTool,
  gitStatusSummaryTool,
  projectReadFilesTool,
  projectSearchTool,
  projectSummaryTool,
  runProjectChecksTool,
} from "./code-agent";
import { getMcpProviderTools, getMcpTools } from "../mcp/client";
import type {
  ToolArgs,
  ToolDefinition,
  ToolExecutionResult,
} from "./types";

function createToolsMap(tools: ToolDefinition[]) { // 创建工具映射表，确保工具名称唯一
  const nextMap = new Map<string, ToolDefinition>();

  for (const tool of tools) {
    if (nextMap.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }

    nextMap.set(tool.name, tool);
  }

  return nextMap;
}

export function registerTools(tools: ToolDefinition[]) { // 注册工具并返回工具列表和映射表
  const toolsMap = createToolsMap(tools);

  return {
    tools,
    toolsMap,
    providerTools: tools.map((tool) => ({ // 转换为提供给代理使用的工具定义格式
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  };
}

export const localToolRegistry = registerTools([
  weatherTool,
  writeDemoFileTool,
  projectSummaryTool,
  projectSearchTool,
  projectReadFilesTool,
  codeProposePatchTool,
  runProjectChecksTool,
  gitStatusSummaryTool,
  gitCreateBranchTool,
  gitCommitChangesTool,
  gitPushBranchTool,
  gitPreparePrSummaryTool,
]); // 在这里注册本地工具，包含基础工具和 code agent 能力

export const registeredTools = localToolRegistry.tools; // 导出已注册的本地工具列表

export async function getRegisteredTools() {
  const mcpTools = await getMcpTools();
  return [...localToolRegistry.tools, ...mcpTools];
}

export async function getProviderTools() { // 导出提供给代理使用的工具定义列表，包含本地工具和 MCP 工具
  const mcpProviderTools = await getMcpProviderTools();
  return [...localToolRegistry.providerTools, ...mcpProviderTools];
}

export async function getTool(name: string) { // 根据工具名称获取工具定义
  const localTool = localToolRegistry.toolsMap.get(name);

  if (localTool) {
    return localTool;
  }

  const mcpTools = await getMcpTools();
  return mcpTools.find((tool) => tool.name === name);
}

export async function executeTool( // 执行工具函数，根据工具名称和参数调用对应的工具执行函数，并返回执行结果
  name: string,
  args: ToolArgs
): Promise<ToolExecutionResult> {
  const tool = await getTool(name);

  if (!tool) {
    return {
      ok: false,
      error: `Unknown tool: ${name}`,
    };
  }

  try {
    const result = await tool.execute(args);

    return {
      ok: true,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown tool error",
    };
  }
}
