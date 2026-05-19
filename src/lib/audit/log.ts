import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  ToolArgs,
  ToolPermission,
  ToolRiskLevel,
} from "../tools/types";

export type ToolAuditEntry = { // 这里的设计是为了记录工具调用的详细信息，包括调用时间、工具名称、调用来源、风险等级、权限要求、参数和调用结果等。这些信息可以帮助我们审计工具的使用情况，分析潜在的安全风险，并提供必要的追踪和调试信息。
  timestamp: string; // timestamp 字段记录了工具调用的时间
  toolName: string;// toolName 字段记录了被调用的工具的名称
  toolCallId?: string;// toolCallId 字段是一个可选字段，用于唯一标识一次工具调用，方便后续的追踪和分析
  source?: "local" | "mcp"; // source 字段是一个可选字段，用于记录工具调用的来源，可以是 "local"（本地调用）或者 "mcp"（通过 MCP 调用） 
  url?: string;
  riskLevel?: ToolRiskLevel;
  permissions?: ToolPermission[];
  args?: ToolArgs;
  outcome:
    | "started"
    | "success"
    | "error"
    | "interrupted"
    | "denied";
  resultSummary?: string;
  detail?: string;// detail 字段是一个可选字段，用于记录工具调用的详细结果或错误信息，提供更多上下文以便后续分析和调试
};

const AUDIT_DIR = path.join(process.cwd(), ".demo-output", "audit");
// AUDIT_LOG_PATH 是日志文件的路径，位于当前工作目录下的 .demo-output/audit/tool-activity.log。这个路径设计为一个专门用于存储工具活动日志的目录，确保日志文件的组织和管理更加清晰。
const AUDIT_LOG_PATH = path.join(AUDIT_DIR, "tool-activity.log");
// appendToolAuditLog 函数是一个异步函数，用于将工具调用的审计日志条目追加到日志文件中。它首先确保审计目录存在（如果不存在则创建），然后将日志条目以 JSON 格式追加到日志文件中，每条日志占一行。这种设计允许我们持续记录工具的使用情况，并且可以方便地进行后续分析和审计。
export async function appendToolAuditLog(entry: ToolAuditEntry) {
  await mkdir(AUDIT_DIR, { recursive: true });
  await appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}
