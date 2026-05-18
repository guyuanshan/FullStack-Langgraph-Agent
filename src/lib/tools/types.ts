export type ToolArgs = Record<string, unknown>; // 工具参数类型定义
export type ToolRiskLevel = "safe" | "confirm_required" | "dangerous";
export type ToolPermission = "read" | "write" | "delete" | "execute";

export type ToolResult = unknown; // 工具结果类型定义，可以是任意类型，根据具体工具的实现而定

export type ToolParameters = { // 工具参数定义类型
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolDefinition = { // 工具定义类型
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: ToolArgs) => Promise<ToolResult>;
  source?: "local" | "mcp";
  riskLevel?: ToolRiskLevel;
  permissions?: ToolPermission[];
};

export type ToolErrorResult = { // 工具错误结果类型定义
  ok: false;
  error: string;
};

export type ToolSuccessResult = { // 工具成功结果类型定义
  ok: true;
  result: ToolResult;
};

export type ToolExecutionResult = ToolSuccessResult | ToolErrorResult; // 工具执行结果类型定义，可以是成功结果或错误结果
