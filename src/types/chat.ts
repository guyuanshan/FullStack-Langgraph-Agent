import type {
  ToolPermission,
  ToolRiskLevel,
} from "../lib/tools/types";

export type MessageRole = "user" | "assistant" | "tool" | "error"; // 消息角色类型定义

export type ToolStatus =
  | "running"
  | "success"
  | "error"
  | "confirm_required"; // 工具调用状态类型定义

export type StreamEvent = // 流事件类型定义
  | {
      type: "text";
      content: string;
    }
  | {
      type: "tool_start";
      toolName: string;
      toolCallId?: string;
      args: Record<string, unknown>;
      toolSummary?: string;
      toolRiskLevel?: ToolRiskLevel;
      toolPermissions?: ToolPermission[];
    }
  | {
      type: "confirm_request";
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      message: string;
      toolSummary?: string;
      toolRiskLevel?: ToolRiskLevel;
      toolPermissions?: ToolPermission[];
    }
  | {
      type: "tool_result";
      toolName: string;
      toolCallId?: string;
      result: unknown;
      toolSummary?: string;
    }
  | {
      type: "tool_error";
      toolName: string;
      toolCallId?: string;
      message: string;
      toolSummary?: string;
    }
  | {
      type: "error";
      message: string;
    };

export interface ChatMessage { // 聊天消息接口定义
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: ToolStatus;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  toolError?: string;
  confirmMessage?: string;
  toolSummary?: string;
  toolRiskLevel?: ToolRiskLevel;
  toolPermissions?: ToolPermission[];
  metadata?: Record<string, unknown>;
}
