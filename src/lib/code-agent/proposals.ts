import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendToolAuditLog } from "../audit/log";
import {
  ErrorCodes,
  getFileSandboxErrorCode,
  readText,
  validateWorkspacePath,
  writeText,
} from "../file-sandbox";
import { createUnifiedDiff } from "./diff";
import { getDefaultSandboxContext, WORKSPACE_ROOT } from "./workspace";
import {
  addProjectMemoryNote,
  getProjectId,
  refreshProjectMemory,
} from "../project-memory";

type PatchProposalFileInput = {
  path: string;
  content: string;
};

type StoredPatchProposalFile = {
  path: string;
  absolutePath: string;
  isNewFile: boolean;
  originalContent: string;
  proposedContent: string;
  diff: string;
};

export type StoredPatchProposal = {
  id: string;
  tenantId: string;
  userId: string | null;
  sessionId: string | null;
  title: string;
  summary: string;
  createdAt: string;
  status: "pending" | "applied" | "rejected";
  files: StoredPatchProposalFile[];
};

type PatchProposalActionFile = {
  path: string;
  content: string;
};

const patchProposalStore = new Map<string, StoredPatchProposal>();

function createProposalId() {
  return `patch_${crypto.randomUUID()}`;
}

function getPatchBackupDir(proposalId: string) {
  return path.join(
    WORKSPACE_ROOT,
    ".demo-output",
    "backups",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${proposalId}`
  );
}

export async function createPatchProposal(options: {
  tenantId: string;
  userId?: string | null;
  sessionId: string | null;
  title: string;
  summary?: string;
  files: PatchProposalFileInput[];
}) {
  if (!options.title.trim()) {
    throw new Error("Patch title is required");
  }

  if (!Array.isArray(options.files) || options.files.length === 0) {
    throw new Error("Patch proposal requires at least one file");
  }

  const files = await Promise.all(
    options.files.map(async (file) => {
      if (typeof file?.path !== "string" || typeof file?.content !== "string") {
        throw new Error("Patch proposal files must include path and content");
      }

      const writeContext = getDefaultSandboxContext("write");
      const validated = validateWorkspacePath(writeContext, file.path, {
        allowRoot: false,
        access: "write",
      });
      const readContext = getDefaultSandboxContext("read");
      let originalContent = "";
      let isNewFile = false;

      try {
        const existing = await readText(readContext, file.path);
        originalContent = existing.content;
      } catch (error) {
        if (getFileSandboxErrorCode(error) === ErrorCodes.NOT_FOUND) {
          isNewFile = true;
        } else {
          const candidate = error as NodeJS.ErrnoException;
          if (candidate.code !== "ENOENT") {
            throw error;
          }
          isNewFile = true;
        }
      }

      const diff = await createUnifiedDiff(
        validated.relativePath,
        originalContent,
        file.content
      );

      if (!diff) {
        throw new Error(`No changes detected for ${validated.relativePath}`);
      }

      return {
        path: validated.relativePath,
        absolutePath: validated.absolutePath,
        isNewFile,
        originalContent,
        proposedContent: file.content,
        diff,
      };
    })
  );

  if (!options.tenantId.trim()) {
    throw new Error("tenantId is required to create a patch proposal");
  }

  const proposal: StoredPatchProposal = {
    id: createProposalId(),
    tenantId: options.tenantId,
    userId: options.userId ?? null,
    sessionId: options.sessionId,
    title: options.title.trim(),
    summary: options.summary?.trim() || "",
    createdAt: new Date().toISOString(),
    status: "pending",
    files,
  };

  patchProposalStore.set(proposal.id, proposal);

  await appendToolAuditLog({
    timestamp: proposal.createdAt,
    tenantId: proposal.tenantId,
    sessionId: proposal.sessionId ?? undefined,
    toolName: "code_propose_patch",
    source: "local",
    riskLevel: "safe",
    permissions: ["read"],
    args: {
      title: proposal.title,
      summary: proposal.summary,
      files: files.map((file) => ({ path: file.path })),
    },
    outcome: "success",
    resultSummary: `proposal ${proposal.id} with ${files.length} file(s)`,
  });

  return {
    kind: "patch_proposal",
    proposalId: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    status: proposal.status,
    createdAt: proposal.createdAt,
    files: files.map((file) => ({
      path: file.path,
      diff: file.diff,
      originalContent: file.originalContent,
      proposedContent: file.proposedContent,
    })),
  };
}

export function getPatchProposal(proposalId: string) {
  return patchProposalStore.get(proposalId) ?? null;
}

export function getTenantPatchProposal(options: {
  proposalId: string;
  tenantId: string;
}) {
  const proposal = getPatchProposal(options.proposalId);

  if (!proposal || proposal.tenantId !== options.tenantId) {
    return null;
  }

  return proposal;
}

/** Test-only helper for in-memory proposal isolation checks. */
export function __setPatchProposalForTests(proposal: StoredPatchProposal) {
  patchProposalStore.set(proposal.id, proposal);
}

/** Test-only helper to clear the in-memory proposal store. */
export function __clearPatchProposalsForTests() {
  patchProposalStore.clear();
}

export async function applyPatchProposal(options: {
  proposalId: string;
  tenantId: string;
  files?: PatchProposalActionFile[];
}) {
  const proposal = getTenantPatchProposal({
    proposalId: options.proposalId,
    tenantId: options.tenantId,
  });

  if (!proposal) {
    throw new Error(`Unknown patch proposal: ${options.proposalId}`);
  }

  if (proposal.status !== "pending") {
    throw new Error(`Patch proposal is already ${proposal.status}`);
  }

  const fileEdits = new Map(
    (options.files ?? []).map((file) => [file.path, file.content])
  );
  const backupDir = getPatchBackupDir(proposal.id);
  await mkdir(backupDir, { recursive: true });

  const writtenFiles = [];

  const writeContext = getDefaultSandboxContext("write");

  for (const file of proposal.files) {
    const nextContent = fileEdits.get(file.path) ?? file.proposedContent;
    const backupPath = path.join(backupDir, file.path);

    await mkdir(path.dirname(backupPath), { recursive: true });

    if (!file.isNewFile) {
      const current = await readText(getDefaultSandboxContext("read"), file.path);
      await writeFile(backupPath, current.content, "utf8");
    }

    const written = await writeText(writeContext, file.path, nextContent);

    file.proposedContent = nextContent;
    file.diff = await createUnifiedDiff(file.path, file.originalContent, nextContent);

    writtenFiles.push({
      path: file.path,
      backupPath: file.isNewFile ? null : backupPath,
      bytes: written.bytes,
      isNewFile: file.isNewFile,
    });
  }

  proposal.status = "applied";

  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
    tenantId: proposal.tenantId,
    sessionId: proposal.sessionId ?? undefined,
    toolName: "code_apply_patch",
    source: "local",
    riskLevel: "confirm_required",
    permissions: ["write"],
    args: {
      proposalId: proposal.id,
      files: writtenFiles.map((file) => ({ path: file.path })),
    },
    outcome: "success",
    resultSummary: `applied ${writtenFiles.length} file(s)`,
    detail: JSON.stringify({
      backupDir,
      files: writtenFiles,
    }),
  });

  const appliedPaths = writtenFiles.map((file) => file.path);
  await refreshProjectMemory({
    paths: appliedPaths,
    tenantId: proposal.tenantId,
    sessionId: proposal.sessionId,
    embeddingProvider: "local",
  });
  await addProjectMemoryNote({
    projectId: getProjectId(),
    tenantId: proposal.tenantId,
    sessionId: proposal.sessionId,
    type:
      /bug|fix|修复/i.test(`${proposal.title} ${proposal.summary}`)
        ? "bug_fix"
        : "patch_memory",
    chunkKey: `patch:${proposal.id}`,
    title: proposal.title,
    content: [
      `Patch title: ${proposal.title}`,
      proposal.summary ? `Summary: ${proposal.summary}` : null,
      `Status: applied`,
      `Files: ${appliedPaths.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      proposalId: proposal.id,
      files: appliedPaths,
      status: "applied",
    },
    embeddingProvider: "local",
  });

  return {
    kind: "patch_apply_result",
    proposalId: proposal.id,
    title: proposal.title,
    status: proposal.status,
    backupDir,
    files: writtenFiles,
  };
}

export async function rejectPatchProposal(options: {
  proposalId: string;
  tenantId: string;
  reason?: string;
}) {
  const proposal = getTenantPatchProposal({
    proposalId: options.proposalId,
    tenantId: options.tenantId,
  });

  if (!proposal) {
    throw new Error(`Unknown patch proposal: ${options.proposalId}`);
  }

  proposal.status = "rejected";

  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
    tenantId: proposal.tenantId,
    sessionId: proposal.sessionId ?? undefined,
    toolName: "code_apply_patch",
    source: "local",
    riskLevel: "confirm_required",
    permissions: ["write"],
    args: {
      proposalId: proposal.id,
    },
    outcome: "denied",
    resultSummary: options.reason ?? "Patch proposal rejected",
  });

  return {
    kind: "patch_apply_result",
    proposalId: proposal.id,
    title: proposal.title,
    status: proposal.status,
    reason: options.reason ?? "User rejected patch proposal",
  };
}
