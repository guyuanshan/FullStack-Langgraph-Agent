import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  isBlockedPathSegment,
  isTextLikeFile,
  validateWorkspacePath,
  WORKSPACE_ROOT,
} from "../code-agent/workspace";
import { buildProjectSummary } from "../code-agent/project";
import { getProjectId, getProjectLabel } from "./project";
import type { MemoryChunk, ProjectMemoryType } from "./types";

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 180;
const MAX_INDEXED_FILE_BYTES = 80_000;
const MAX_INDEXED_FILES = 250;
const BLOCKED_PATH_PREFIXES = ["src/generated/", "prisma/migrations/"];

function detectMemoryType(filePath: string): ProjectMemoryType {
  const lower = filePath.toLowerCase();

  if (lower === "readme.md" || lower.endsWith("/readme.md")) {
    return "readme_chunk";
  }

  if (/\.(md|mdx|txt|ya?ml)$/i.test(lower)) {
    return "doc_chunk";
  }

  return "code_chunk";
}

function isBlockedMemoryPath(filePath: string) {
  return BLOCKED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function splitTextIntoChunks(content: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  const normalized = content.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const softBreak = normalized.lastIndexOf("\n\n", end);
      const hardBreak = normalized.lastIndexOf("\n", end);
      const nextEnd = softBreak > start + 400 ? softBreak : hardBreak > start + 400 ? hardBreak : end;
      end = nextEnd;
    }

    const chunk = normalized.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

async function collectIndexableFiles(
  directoryPath: string,
  rootRelativePath = "",
  results: Array<{ path: string; size: number }> = []
) {
  if (results.length >= MAX_INDEXED_FILES) {
    return results;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= MAX_INDEXED_FILES) {
      break;
    }

    if (entry.name === ".DS_Store" || isBlockedPathSegment(entry.name)) {
      continue;
    }

    const nextRelativePath = rootRelativePath
      ? `${rootRelativePath}/${entry.name}`
      : entry.name;
    const nextAbsolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await collectIndexableFiles(nextAbsolutePath, nextRelativePath, results);
      continue;
    }

    if (
      !entry.isFile() ||
      !isTextLikeFile(nextRelativePath) ||
      isBlockedMemoryPath(nextRelativePath)
    ) {
      continue;
    }

    try {
      validateWorkspacePath(nextRelativePath);
    } catch {
      continue;
    }

    const fileStat = await stat(nextAbsolutePath);

    if (fileStat.size > MAX_INDEXED_FILE_BYTES) {
      continue;
    }

    results.push({
      path: nextRelativePath,
      size: fileStat.size,
    });
  }

  return results;
}

async function createFileChunks(projectId: string, relativePath: string) {
  const { absolutePath, relativePath: safePath } = validateWorkspacePath(relativePath);
  const content = await readFile(absolutePath, "utf8");
  const chunks = splitTextIntoChunks(content);
  const type = detectMemoryType(safePath);

  return chunks.map(
    (chunk, index): MemoryChunk => ({
      projectId,
      type,
      sourcePath: safePath,
      chunkKey: `file:${safePath}#${index}`,
      title: safePath,
      content: chunk,
      metadata: {
        path: safePath,
        chunkIndex: index,
        chunkCount: chunks.length,
      },
    })
  );
}

export async function buildProjectMemoryChunksForPaths(relativePaths: string[]) {
  const projectId = getProjectId();
  const chunks = (
    await Promise.all(
      relativePaths.map((relativePath) => createFileChunks(projectId, relativePath))
    )
  ).flat();

  return {
    projectId,
    chunks,
  };
}

export async function buildProjectMemoryChunks() {
  const projectId = getProjectId();
  const summary = await buildProjectSummary();
  const files = await collectIndexableFiles(WORKSPACE_ROOT);

  const summaryChunks: MemoryChunk[] = [
    {
      projectId,
      type: "project_structure",
      sourcePath: null,
      chunkKey: "summary:project-structure",
      title: `${getProjectLabel()} project structure`,
      content: [
        `Project name: ${summary.name}`,
        `Package manager: ${summary.packageManager}`,
        `Top-level directories: ${summary.topLevelDirectories.join(", ")}`,
        `Top-level files: ${summary.topLevelFiles.join(", ")}`,
        `Indexed file count: ${summary.indexedFileCount}`,
      ].join("\n"),
      metadata: {
        sampleFiles: summary.sampleFiles.slice(0, 15),
      },
    },
    {
      projectId,
      type: "tech_stack",
      sourcePath: "package.json",
      chunkKey: "summary:tech-stack",
      title: `${getProjectLabel()} tech stack`,
      content: [
        `技术栈: ${summary.stack.join(", ") || "Unknown"}`,
        `Stack: ${summary.stack.join(", ") || "Unknown"}`,
        `核心依赖与框架: ${summary.stack.join(", ") || "Unknown"}`,
        `Scripts: ${JSON.stringify(summary.scripts)}`,
      ].join("\n"),
      metadata: {
        stack: summary.stack,
      },
    },
  ];

  const fileChunks = (
    await Promise.all(files.map((file) => createFileChunks(projectId, file.path)))
  ).flat();

  return {
    projectId,
    chunks: [...summaryChunks, ...fileChunks],
    indexedFiles: files.length,
  };
}
