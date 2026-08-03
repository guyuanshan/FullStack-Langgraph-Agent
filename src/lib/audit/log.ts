import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/client";
import { DEFAULT_TENANT_ID, resolveWriteTenantId } from "../db/tenant";
import type {
  ToolArgs,
  ToolPermission,
  ToolRiskLevel,
} from "../tools/types";

export type ToolAuditEntry = {
  timestamp: string;
  tenantId?: string;
  sessionId?: string;
  toolName: string;
  toolCallId?: string;
  source?: "local" | "mcp";
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
  latencyMs?: number;
  detail?: string;
};

const AUDIT_DIR = path.join(process.cwd(), ".demo-output", "audit");
// AUDIT_LOG_PATH 是日志文件的路径，位于当前工作目录下的 .demo-output/audit/tool-activity.log。这个路径设计为一个专门用于存储工具活动日志的目录，确保日志文件的组织和管理更加清晰。
const AUDIT_LOG_PATH = path.join(AUDIT_DIR, "tool-activity.log");
// appendToolAuditLog 函数是一个异步函数，用于将工具调用的审计日志条目追加到日志文件中。它首先确保审计目录存在（如果不存在则创建），然后将日志条目以 JSON 格式追加到日志文件中，每条日志占一行。这种设计允许我们持续记录工具的使用情况，并且可以方便地进行后续分析和审计。
export async function appendToolAuditLog(entry: ToolAuditEntry) {
  await mkdir(AUDIT_DIR, { recursive: true });

  let tenantId: string;

  try {
    tenantId = await resolveWriteTenantId({
      tenantId: entry.tenantId,
      sessionId: entry.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.startsWith("TENANT_MISMATCH")) {
      throw error;
    }

    // Standalone code-agent audits may omit session context.
    if (!entry.sessionId) {
      tenantId = entry.tenantId ?? DEFAULT_TENANT_ID;
    } else {
      throw error;
    }
  }

  await Promise.all([
    appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8"),
    prisma.auditLog
      .create({
        data: {
          tenantId,
          sessionId: entry.sessionId ?? null,
          toolCallId: entry.toolCallId ?? null,
          toolName: entry.toolName,
          source: entry.source ?? null,
          url: entry.url ?? null,
          riskLevel: entry.riskLevel ?? null,
          permissions: entry.permissions?.length
            ? entry.permissions.join(",")
            : null,
          status: entry.outcome,
          argsJson: entry.args ? JSON.stringify(entry.args) : null,
          resultSummary: entry.resultSummary ?? null,
          detail: entry.detail ?? null,
          latencyMs: entry.latencyMs ?? null,
          createdAt: new Date(entry.timestamp),
        },
      })
      .catch((error: unknown) => {
        console.error("Failed to persist audit log to database", error);
      }),
  ]);
}
