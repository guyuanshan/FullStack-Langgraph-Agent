import type { ChatMessage } from "../../types/chat";
import { getResultLink } from "../../lib/tools/summary";

function formatJson(value: unknown) { // 格式化 JSON，undefined 显示为 ""
  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function getStatusLabel(message: ChatMessage) { // 获取状态标签
  if (message.toolStatus === "running") { // 运行中
    return "Running";
  }

  if (message.toolStatus === "confirm_required") {
    return "Needs approval";
  }

  if (message.toolStatus === "success") {
    return "Completed"; // 成功
  }

  if (message.toolStatus === "error") {
    return "Failed"; // 失败
  }

  return "Pending";
}

function getStatusClasses(message: ChatMessage) { // 获取状态类名
  if (message.toolStatus === "running") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (message.toolStatus === "confirm_required") {
    return "border-blue-200 bg-blue-50 text-blue-900";
  }

  if (message.toolStatus === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (message.toolStatus === "error") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  return "border-slate-200 bg-slate-50 text-slate-900";
}

type ToolCallCardProps = {
  message: ChatMessage;
  onConfirm?: (message: ChatMessage) => void;
  onReject?: (message: ChatMessage) => void;
};

export function ToolCallCard({
  message,
  onConfirm,
  onReject,
}: ToolCallCardProps) {
  const resultLink = getResultLink(message.toolResult);

  return (
    <div className="max-w-[85%] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Tool Call
          </p>
          <h3 className="text-sm font-semibold text-slate-900">
            {message.toolName ?? "Unknown tool"}
          </h3> 
        </div>

        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(
            message
          )}`}
        >
          {getStatusLabel(message)}
        </span>
      </div>

      {message.toolArgs && (
        <div className="mt-3">
          {message.toolSummary && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              Target: <span className="text-slate-800">{message.toolSummary}</span>
            </p>
          )}

          {(message.toolRiskLevel || message.toolPermissions?.length) && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              {message.toolRiskLevel ? `Risk: ${message.toolRiskLevel}` : ""}
              {message.toolRiskLevel && message.toolPermissions?.length ? " · " : ""}
              {message.toolPermissions?.length
                ? `Permissions: ${message.toolPermissions.join(", ")}`
                : ""}
            </p>
          )}

          <p className="mb-1 text-xs font-medium text-slate-500">Arguments</p>
          <pre className="overflow-x-auto rounded-xl bg-slate-950/95 p-3 text-xs leading-5 text-slate-100">
            {formatJson(message.toolArgs)}
          </pre>
        </div>
      )}

      {message.toolResult !== undefined && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Result</p>
          {resultLink && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              Link:{" "}
              <a
                href={resultLink}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                {resultLink}
              </a>
            </p>
          )}
          <pre className="overflow-x-auto rounded-xl bg-slate-950/95 p-3 text-xs leading-5 text-slate-100">
            {formatJson(message.toolResult)}
          </pre>
        </div>
      )}

      {message.toolError && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message.toolError}
        </div>
      )}

      {message.toolStatus === "confirm_required" && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="text-sm text-blue-900">
            {message.confirmMessage ??
              "This tool requires your approval before it can run."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onConfirm?.(message)}
              className="rounded-lg bg-black px-3 py-2 text-sm text-white"
            >
              允许执行
            </button>
            <button
              type="button"
              onClick={() => onReject?.(message)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              拒绝
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
