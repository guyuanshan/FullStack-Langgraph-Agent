import Image from "next/image";
import { useState } from "react";
import type { ChatMessage } from "../../types/chat";
import { getResultLink } from "../../lib/tools/summary";

function formatJson(value: unknown) {
  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function getStatusLabel(message: ChatMessage) {
  if (message.toolStatus === "running") {
    return "Running";
  }

  if (message.toolStatus === "confirm_required") {
    return "Needs approval";
  }

  if (message.toolStatus === "success") {
    return "Completed";
  }

  if (message.toolStatus === "error") {
    return "Failed";
  }

  return "Pending";
}

function getStatusClasses(message: ChatMessage) {
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

function getBrowserResultData(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return {
    url: typeof candidate.url === "string" ? candidate.url : null,
    title: typeof candidate.title === "string" ? candidate.title : null,
    linksCount:
      typeof candidate.linksCount === "number" ? candidate.linksCount : null,
    previewDataUrl:
      typeof candidate.previewDataUrl === "string"
        ? candidate.previewDataUrl
        : null,
  };
}

type PatchProposalFile = {
  path: string;
  diff: string;
  originalContent: string;
  proposedContent: string;
};

function getPatchProposalData(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    candidate.kind !== "patch_proposal" ||
    typeof candidate.proposalId !== "string" ||
    !Array.isArray(candidate.files)
  ) {
    return null;
  }

  const files = candidate.files.filter(
    (file): file is PatchProposalFile =>
      !!file &&
      typeof file === "object" &&
      typeof (file as Record<string, unknown>).path === "string" &&
      typeof (file as Record<string, unknown>).diff === "string" &&
      typeof (file as Record<string, unknown>).originalContent === "string" &&
      typeof (file as Record<string, unknown>).proposedContent === "string"
  );

  return {
    proposalId: candidate.proposalId,
    title: typeof candidate.title === "string" ? candidate.title : "Patch proposal",
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    status: typeof candidate.status === "string" ? candidate.status : "pending",
    files,
  };
}

type PatchApplyResult = {
  proposalId: string;
  status: string;
  backupDir?: string;
  reason?: string;
};

function getPatchApplyResult(value: unknown): PatchApplyResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    candidate.kind !== "patch_apply_result" ||
    typeof candidate.proposalId !== "string" ||
    typeof candidate.status !== "string"
  ) {
    return null;
  }

  return {
    proposalId: candidate.proposalId,
    status: candidate.status,
    backupDir:
      typeof candidate.backupDir === "string" ? candidate.backupDir : undefined,
    reason: typeof candidate.reason === "string" ? candidate.reason : undefined,
  };
}

type ToolCallCardProps = {
  message: ChatMessage;
  onConfirm?: (message: ChatMessage) => void;
  onReject?: (message: ChatMessage) => void;
  onApprovePatch?: (
    message: ChatMessage,
    files: Array<{ path: string; content: string }>
  ) => void;
  onRejectPatch?: (message: ChatMessage) => void;
};

type PatchProposalEditorProps = {
  message: ChatMessage;
  patchProposal: {
    proposalId: string;
    title: string;
    summary: string;
    status: string;
    files: PatchProposalFile[];
  };
  onApprovePatch?: (
    message: ChatMessage,
    files: Array<{ path: string; content: string }>
  ) => void;
  onRejectPatch?: (message: ChatMessage) => void;
};

function PatchProposalEditor({
  message,
  patchProposal,
  onApprovePatch,
  onRejectPatch,
}: PatchProposalEditorProps) {
  const [editedFiles, setEditedFiles] = useState(
    patchProposal.files.map((file) => ({
      path: file.path,
      content: file.proposedContent,
    }))
  );

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-900">{patchProposal.title}</p>
        {patchProposal.summary ? (
          <p className="mt-1 text-sm text-slate-700">{patchProposal.summary}</p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">
          Proposal ID: {patchProposal.proposalId}
        </p>
      </div>

      {patchProposal.files.map((file, index) => (
        <div
          key={file.path}
          className="space-y-2 rounded-xl border border-slate-200 p-3"
        >
          <p className="text-sm font-semibold text-slate-900">{file.path}</p>
          <pre className="overflow-x-auto rounded-xl bg-slate-950/95 p-3 text-xs leading-5 text-slate-100">
            {file.diff}
          </pre>
          <label className="block text-xs font-medium text-slate-500">
            Editable proposed content
          </label>
          <textarea
            value={editedFiles[index]?.content ?? file.proposedContent}
            onChange={(event) =>
              setEditedFiles((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === index
                    ? {
                        ...item,
                        content: event.target.value,
                      }
                    : item
                )
              )
            }
            className="min-h-48 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-900"
          />
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onApprovePatch?.(message, editedFiles)}
          className="rounded-lg bg-black px-3 py-2 text-sm text-white"
        >
          应用补丁
        </button>
        <button
          type="button"
          onClick={() => onRejectPatch?.(message)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
        >
          拒绝补丁
        </button>
      </div>
    </div>
  );
}

export function ToolCallCard({
  message,
  onConfirm,
  onReject,
  onApprovePatch,
  onRejectPatch,
}: ToolCallCardProps) {
  const resultLink = getResultLink(message.toolResult);
  const browserResult = getBrowserResultData(message.toolResult);
  const patchProposal = getPatchProposalData(message.toolResult);
  const patchApplyResult = getPatchApplyResult(message.toolResult);
  const previewDataUrl = browserResult?.previewDataUrl ?? null;
  const linksCount = browserResult?.linksCount ?? null;

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

      {patchProposal && (
        <PatchProposalEditor
          key={patchProposal.proposalId}
          message={message}
          patchProposal={patchProposal}
          onApprovePatch={onApprovePatch}
          onRejectPatch={onRejectPatch}
        />
      )}

      {message.toolResult !== undefined && !patchProposal && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Result</p>
          {browserResult?.url && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              URL: <span className="text-slate-800">{browserResult.url}</span>
            </p>
          )}
          {browserResult?.title && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              Title: <span className="text-slate-800">{browserResult.title}</span>
            </p>
          )}
          {linksCount !== null && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              Links: <span className="text-slate-800">{linksCount}</span>
            </p>
          )}
          {patchApplyResult?.backupDir && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              Backup: <span className="text-slate-800">{patchApplyResult.backupDir}</span>
            </p>
          )}
          {patchApplyResult?.reason && (
            <p className="mb-2 text-xs font-medium text-slate-500">
              Reason: <span className="text-slate-800">{patchApplyResult.reason}</span>
            </p>
          )}
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
          {previewDataUrl && (
            <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
              <Image
                src={previewDataUrl}
                alt="Browser screenshot preview"
                width={1200}
                height={800}
                unoptimized
                className="max-h-64 w-full object-cover"
              />
            </div>
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
