import type { ToolArgs, ToolDefinition, ToolExecutionResult } from "../types";

/**
 * The low-level execution primitive is intentionally not re-exported. The
 * authorization Gateway is its only production importer.
 */
export async function invokeRegisteredTool(
  tool: ToolDefinition,
  args: ToolArgs
): Promise<ToolExecutionResult> {
  try {
    return {
      ok: true,
      result: await tool.execute(args),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown tool error",
    };
  }
}
