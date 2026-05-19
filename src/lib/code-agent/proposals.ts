import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendToolAuditLog } from "../audit/log";
import { createUnifiedDiff } from "./diff";
import { validateWorkspacePath, WORKSPACE_ROOT } from "./workspace";

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

      const validated = validateWorkspacePath(file.path);
      let originalContent = "";
      let isNewFile = false;

      try {
        originalContent = await readFile(validated.absolutePath, "utf8");
      } catch (error) {
        const candidate = error as NodeJS.ErrnoException;

        if (candidate.code !== "ENOENT") {
          throw error;
        }

        isNewFile = true;
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

  const proposal: StoredPatchProposal = {
    id: createProposalId(),
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

export async function applyPatchProposal(options: {
  proposalId: string;
  files?: PatchProposalActionFile[];
}) {
  const proposal = getPatchProposal(options.proposalId);

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

  for (const file of proposal.files) {
    const nextContent = fileEdits.get(file.path) ?? file.proposedContent;
    const validated = validateWorkspacePath(file.path);
    const backupPath = path.join(backupDir, file.path);

    await mkdir(path.dirname(backupPath), { recursive: true });
    await mkdir(path.dirname(validated.absolutePath), { recursive: true });

    if (!file.isNewFile) {
      await copyFile(validated.absolutePath, backupPath);
    }

    await writeFile(validated.absolutePath, nextContent, "utf8");

    file.proposedContent = nextContent;
    file.diff = await createUnifiedDiff(file.path, file.originalContent, nextContent);

    writtenFiles.push({
      path: file.path,
      backupPath: file.isNewFile ? null : backupPath,
      bytes: Buffer.byteLength(nextContent, "utf8"),
      isNewFile: file.isNewFile,
    });
  }

  proposal.status = "applied";

  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
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
  reason?: string;
}) {
  const proposal = getPatchProposal(options.proposalId);

  if (!proposal) {
    throw new Error(`Unknown patch proposal: ${options.proposalId}`);
  }

  proposal.status = "rejected";

  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
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
