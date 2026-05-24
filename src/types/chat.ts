import type {
  ToolPermission,
  ToolRiskLevel,
} from "../lib/tools/types";

export type MessageRole = "user" | "assistant" | "tool" | "error" | "agent"; // 消息角色类型定义

export type ToolStatus =
  | "running"
  | "success"
  | "error"
  | "confirm_required"; // 工具调用状态类型定义

export type StreamEvent = // 流事件类型定义
  | {
      type: "run_started";
      runId: string;
      runtimeType: "manual" | "langgraph" | "multi_agent";
    }
  | {
      type: "run_finished";
      runId: string;
      status: "completed" | "interrupted" | "error";
      completionReason?: string;
    }
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
      type: "tool_progress";
      toolName: string;
      toolCallId?: string;
      progress: {
        phase: "scanning" | "embedding";
        completed: number;
        total: number;
        chunkKey?: string;
        sourcePath?: string | null;
      };
    }
  | {
      type: "tool_error";
      toolName: string;
      toolCallId?: string;
      message: string;
      toolSummary?: string;
    }
  | {
      type: "agent_status";
      agentName: "planner" | "code" | "browser" | "reviewer" | "tool_executor" | "finalizer";
      phase: "started" | "completed" | "handoff" | "error";
      message: string;
      latencyMs?: number;
      toolCount?: number;
    }
  | {
      type: "agent_delta";
      agentName: "planner" | "code" | "browser" | "reviewer" | "tool_executor" | "finalizer";
      text: string;
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
  agentName?: "planner" | "code" | "browser" | "reviewer" | "tool_executor" | "finalizer";
  agentPhase?: "started" | "completed" | "handoff" | "error";
  latencyMs?: number;
  toolCount?: number;
  toolProgress?: {
    phase: "scanning" | "embedding";
    completed: number;
    total: number;
    chunkKey?: string;
    sourcePath?: string | null;
  };
}
