/**
 * Shared FileSandbox core (framework-free).
 * Used by TypeScript wrappers and the Filesystem MCP (.mjs) so path policy stays singular.
 */

import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const ErrorCodes = Object.freeze({
  PATH_EMPTY: "PATH_EMPTY",
  PATH_INVALID: "PATH_INVALID",
  PATH_TOO_LONG: "PATH_TOO_LONG",
  PATH_ABSOLUTE: "PATH_ABSOLUTE",
  PATH_OUTSIDE_WORKSPACE: "PATH_OUTSIDE_WORKSPACE",
  SENSITIVE_PATH: "SENSITIVE_PATH",
  ACCESS_DENIED: "ACCESS_DENIED",
  SYMLINK_DENIED: "SYMLINK_DENIED",
  NOT_A_FILE: "NOT_A_FILE",
  NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  NOT_FOUND: "NOT_FOUND",
  WORKSPACE_INVALID: "WORKSPACE_INVALID",
});

export class FileSandboxError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "FileSandboxError";
    this.code = code;
  }
}

/** @type {Readonly<{
 *   maxPathLength: number;
 *   maxReadBytes: number;
 *   maxWriteBytes: number;
 *   maxListEntries: number;
 *   maxSearchDepth: number;
 *   maxSearchFilesScanned: number;
 *   maxSearchResults: number;
 *   maxSearchFileBytes: number;
 *   maxSearchTotalReadBytes: number;
 * }>} */
export const DEFAULT_LIMITS = Object.freeze({
  maxPathLength: 4096,
  maxReadBytes: 2 * 1024 * 1024,
  maxWriteBytes: 1 * 1024 * 1024,
  maxListEntries: 500,
  maxSearchDepth: 12,
  maxSearchFilesScanned: 2000,
  maxSearchResults: 100,
  maxSearchFileBytes: 512 * 1024,
  maxSearchTotalReadBytes: 8 * 1024 * 1024,
});

const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".demo-output",
  "coverage",
  "dist",
  "build",
  ".pnpm-store",
]);

const SENSITIVE_BASENAME_EXACT = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
]);

const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env\..+/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /credentials/i,
  /secret/i,
  /\.db$/i,
  /\.sqlite$/i,
  /\.sqlite3$/i,
];

const READ_ONLY_EXCEPTIONS = new Set([".env.example"]);

const TEXT_LIKE_EXTENSION =
  /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|html?|ya?ml|txt|sh|svg|toml|ini|cfg|conf|graphql|sql|prisma)$/i;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new FileSandboxError(code, message);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @returns {string}
 */
export function resolveConfiguredWorkspaceRoot() {
  const configured =
    process.env.AGENT_WORKSPACE_ROOT?.trim() ||
    process.env.MCP_WORKSPACE_ROOT?.trim() ||
    "";

  if (configured) {
    return path.resolve(configured);
  }

  // Temporary local fallback until section 4.2 removes process.cwd() in production.
  return path.resolve(process.cwd());
}

/**
 * @param {string} workspaceRoot
 */
export async function canonicalizeWorkspaceRoot(workspaceRoot) {
  if (!isNonEmptyString(workspaceRoot)) {
    fail(ErrorCodes.WORKSPACE_INVALID, "workspaceRoot is required");
  }

  if (!path.isAbsolute(workspaceRoot)) {
    fail(ErrorCodes.WORKSPACE_INVALID, "workspaceRoot must be an absolute path");
  }

  let canonical;
  try {
    canonical = await realpath(workspaceRoot);
  } catch (error) {
    const candidate = error;
    if (candidate && typeof candidate === "object" && "code" in candidate && candidate.code === "ENOENT") {
      fail(ErrorCodes.WORKSPACE_INVALID, "workspaceRoot does not exist");
    }
    throw error;
  }

  if (canonical === path.parse(canonical).root) {
    fail(ErrorCodes.WORKSPACE_INVALID, "workspaceRoot cannot be a filesystem root");
  }

  return canonical;
}

/**
 * @param {{
 *   tenantId: string;
 *   runId: string;
 *   workspaceRoot: string;
 *   access?: "read" | "write" | "delete";
 *   limits?: Partial<typeof DEFAULT_LIMITS>;
 * }} options
 */
export async function createFileSandboxContext(options) {
  if (!isNonEmptyString(options?.tenantId)) {
    fail(ErrorCodes.WORKSPACE_INVALID, "tenantId is required");
  }
  if (!isNonEmptyString(options?.runId)) {
    fail(ErrorCodes.WORKSPACE_INVALID, "runId is required");
  }

  const canonicalRoot = await canonicalizeWorkspaceRoot(options.workspaceRoot);

  return {
    tenantId: options.tenantId,
    runId: options.runId,
    workspaceRoot: canonicalRoot,
    access: options.access ?? "read",
    limits: {
      ...DEFAULT_LIMITS,
      ...(options.limits ?? {}),
    },
  };
}

/**
 * @param {{
 *   tenantId?: string;
 *   runId?: string;
 *   access?: "read" | "write" | "delete";
 *   limits?: Partial<typeof DEFAULT_LIMITS>;
 * }} [options]
 */
export async function createDefaultFileSandboxContext(options = {}) {
  return createFileSandboxContext({
    tenantId: options.tenantId ?? "default",
    runId: options.runId ?? "local",
    workspaceRoot: resolveConfiguredWorkspaceRoot(),
    access: options.access ?? "read",
    limits: options.limits,
  });
}

/**
 * @param {string} segment
 */
export function isBlockedPathSegment(segment) {
  return BLOCKED_SEGMENTS.has(segment);
}

/**
 * @param {string} filePath
 */
export function isTextLikeFile(filePath) {
  return TEXT_LIKE_EXTENSION.test(filePath);
}

/**
 * @param {string} relativePath
 * @param {"read" | "write" | "delete"} access
 */
export function evaluateSensitivePath(relativePath, access) {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) ?? "";

  if (READ_ONLY_EXCEPTIONS.has(basename)) {
    if (access === "read") {
      return { allowed: true, reason: null };
    }
    return {
      allowed: false,
      reason: "Read-only exception path cannot be written or deleted",
    };
  }

  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
    return { allowed: false, reason: "Blocked path segment" };
  }

  if (SENSITIVE_BASENAME_EXACT.has(basename)) {
    return { allowed: false, reason: "Sensitive filename" };
  }

  if (SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))) {
    return { allowed: false, reason: "Sensitive filename pattern" };
  }

  if ((access === "write" || access === "delete") && !isTextLikeFile(normalized)) {
    return {
      allowed: false,
      reason: "Write/delete only allows text-like project files",
    };
  }

  return { allowed: true, reason: null };
}

/**
 * @param {string} inputPath
 * @param {number} maxPathLength
 */
function normalizeInputPath(inputPath, maxPathLength) {
  if (typeof inputPath !== "string") {
    fail(ErrorCodes.PATH_INVALID, "Path must be a string");
  }

  const trimmed = inputPath.trim();
  if (!trimmed) {
    fail(ErrorCodes.PATH_EMPTY, "Path cannot be empty");
  }

  if (trimmed.length > maxPathLength) {
    fail(ErrorCodes.PATH_TOO_LONG, "Path exceeds maximum length");
  }

  if (trimmed.includes("\0") || CONTROL_CHAR_PATTERN.test(trimmed)) {
    fail(ErrorCodes.PATH_INVALID, "Path contains invalid characters");
  }

  const unified = trimmed.replace(/\\/g, "/");

  if (path.win32.isAbsolute(unified) || path.posix.isAbsolute(unified)) {
    fail(ErrorCodes.PATH_ABSOLUTE, "Path must be workspace-relative");
  }

  // Reject Windows drive-letter forms that path.isAbsolute may miss on POSIX.
  if (/^[a-zA-Z]:/.test(unified)) {
    fail(ErrorCodes.PATH_ABSOLUTE, "Path must be workspace-relative");
  }

  return unified;
}

/**
 * @param {string} canonicalRoot
 * @param {string} candidate
 */
function assertInsideWorkspace(canonicalRoot, candidate) {
  const relativePath = path.relative(canonicalRoot, candidate);

  if (
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    fail(ErrorCodes.PATH_OUTSIDE_WORKSPACE, "Path is outside the workspace");
  }

  return relativePath.replace(/\\/g, "/");
}

/**
 * @param {object} context
 * @param {string} inputPath
 * @param {{ allowRoot?: boolean; access: "read" | "write" | "delete" }} options
 */
export function resolveLogicalPath(context, inputPath, options) {
  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  const normalized = normalizeInputPath(inputPath, limits.maxPathLength);
  const candidate = path.resolve(context.workspaceRoot, normalized);
  const relativePath = assertInsideWorkspace(context.workspaceRoot, candidate);

  if (!options.allowRoot && (relativePath === "" || relativePath === ".")) {
    fail(ErrorCodes.PATH_INVALID, "Path must target a file or subdirectory");
  }

  const logicalRelative =
    relativePath === "" || relativePath === "." ? "." : relativePath;

  const sensitivity = evaluateSensitivePath(
    logicalRelative === "." ? "." : logicalRelative,
    options.access
  );

  // Root "." is never a sensitive file; segment checks on "." are a no-op.
  if (logicalRelative !== "." && !sensitivity.allowed) {
    fail(ErrorCodes.SENSITIVE_PATH, "Access to sensitive path is not allowed");
  }

  if (logicalRelative !== "." && options.access !== "read") {
    // Re-check write/delete text-like policy already covered in evaluateSensitivePath.
  }

  return {
    absolutePath: candidate,
    relativePath: logicalRelative,
    access: options.access,
  };
}

/**
 * Walk from the canonical root to the target, lstat-ing each segment so
 * intermediate symlinks cannot be followed into an escape.
 *
 * @param {string} absolutePath
 * @param {string} canonicalRoot
 * @returns {Promise<string | null>} realpath when the target exists; null when creating a new path
 */
async function assertNoSymlinkEscape(absolutePath, canonicalRoot) {
  const relativePath = assertInsideWorkspace(canonicalRoot, absolutePath);
  const segments =
    relativePath === "" || relativePath === "."
      ? []
      : relativePath.split(path.sep).filter(Boolean);

  let current = canonicalRoot;

  for (const segment of segments) {
    current = path.join(current, segment);

    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      const candidate = error;
      if (
        candidate &&
        typeof candidate === "object" &&
        "code" in candidate &&
        candidate.code === "ENOENT"
      ) {
        // Target (or an intermediate directory) does not exist yet.
        return null;
      }
      throw error;
    }

    if (info.isSymbolicLink()) {
      fail(ErrorCodes.SYMLINK_DENIED, "Symbolic links are not allowed");
    }
  }

  const real = await realpath(absolutePath);
  assertInsideWorkspace(canonicalRoot, real);
  return real;
}

/**
 * @param {object} context
 * @param {string} inputPath
 */
export async function resolveForRead(context, inputPath) {
  const logical = resolveLogicalPath(context, inputPath, {
    allowRoot: false,
    access: "read",
  });

  const real = await assertNoSymlinkEscape(
    logical.absolutePath,
    context.workspaceRoot
  );

  if (!real) {
    fail(ErrorCodes.NOT_FOUND, "Path does not exist");
  }

  const info = await lstat(real);
  if (info.isSymbolicLink()) {
    fail(ErrorCodes.SYMLINK_DENIED, "Symbolic links are not allowed");
  }
  if (!info.isFile()) {
    fail(ErrorCodes.NOT_A_FILE, "Path is not a regular file");
  }

  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  if (info.size > limits.maxReadBytes) {
    fail(ErrorCodes.FILE_TOO_LARGE, "File exceeds maximum read size");
  }

  return {
    ...logical,
    absolutePath: real,
    size: info.size,
  };
}

/**
 * @param {object} context
 * @param {string} inputPath
 */
export async function resolveForWrite(context, inputPath) {
  const logical = resolveLogicalPath(context, inputPath, {
    allowRoot: false,
    access: "write",
  });

  await assertNoSymlinkEscape(logical.absolutePath, context.workspaceRoot);

  try {
    const info = await lstat(logical.absolutePath);
    if (info.isSymbolicLink()) {
      fail(ErrorCodes.SYMLINK_DENIED, "Symbolic links are not allowed");
    }
    if (!info.isFile()) {
      fail(ErrorCodes.NOT_A_FILE, "Path is not a regular file");
    }
  } catch (error) {
    const candidate = error;
    if (!(candidate && typeof candidate === "object" && "code" in candidate && candidate.code === "ENOENT")) {
      throw error;
    }
  }

  return logical;
}

/**
 * @param {object} context
 * @param {string} inputPath
 */
export async function resolveForDelete(context, inputPath) {
  const logical = resolveLogicalPath(context, inputPath, {
    allowRoot: false,
    access: "delete",
  });

  const real = await assertNoSymlinkEscape(
    logical.absolutePath,
    context.workspaceRoot
  );

  if (!real) {
    fail(ErrorCodes.NOT_FOUND, "Path does not exist");
  }

  const info = await lstat(real);
  if (info.isSymbolicLink()) {
    fail(ErrorCodes.SYMLINK_DENIED, "Symbolic links are not allowed");
  }
  if (!info.isFile()) {
    fail(ErrorCodes.NOT_A_FILE, "Delete is only allowed for regular files");
  }

  return {
    ...logical,
    absolutePath: real,
  };
}

/**
 * @param {object} context
 * @param {string} inputPath
 */
export async function resolveForList(context, inputPath = ".") {
  const logical = resolveLogicalPath(context, inputPath || ".", {
    allowRoot: true,
    access: "read",
  });

  const target =
    logical.relativePath === "."
      ? context.workspaceRoot
      : logical.absolutePath;

  const real = await assertNoSymlinkEscape(target, context.workspaceRoot);
  if (!real) {
    fail(ErrorCodes.NOT_FOUND, "Path does not exist");
  }

  const info = await lstat(real);
  if (info.isSymbolicLink()) {
    fail(ErrorCodes.SYMLINK_DENIED, "Symbolic links are not allowed");
  }
  if (!info.isDirectory()) {
    fail(ErrorCodes.NOT_A_DIRECTORY, "Path is not a directory");
  }

  return {
    ...logical,
    absolutePath: real,
    relativePath: logical.relativePath === "." ? "." : logical.relativePath,
  };
}

/**
 * @param {object} context
 * @param {string} inputPath
 */
export async function readText(context, inputPath) {
  const resolved = await resolveForRead(context, inputPath);
  const openFlags =
    typeof fsConstants.O_NOFOLLOW === "number"
      ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
      : fsConstants.O_RDONLY;

  let handle;
  try {
    handle = await open(resolved.absolutePath, openFlags);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      fail(ErrorCodes.NOT_A_FILE, "Path is not a regular file");
    }

    const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
    if (stats.size > limits.maxReadBytes) {
      fail(ErrorCodes.FILE_TOO_LARGE, "File exceeds maximum read size");
    }

    const content = await handle.readFile("utf8");
    return {
      path: resolved.relativePath,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  } finally {
    await handle?.close();
  }
}

/**
 * @param {object} context
 * @param {string} inputPath
 * @param {string} content
 */
export async function writeText(context, inputPath, content) {
  if (typeof content !== "string") {
    fail(ErrorCodes.PATH_INVALID, "Content must be a string");
  }

  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.maxWriteBytes) {
    fail(ErrorCodes.FILE_TOO_LARGE, "Content exceeds maximum write size");
  }

  const resolved = await resolveForWrite(context, inputPath);
  const parent = path.dirname(resolved.absolutePath);
  await mkdir(parent, { recursive: true });

  // Re-validate parent after mkdir in case it was newly created.
  await assertNoSymlinkEscape(resolved.absolutePath, context.workspaceRoot);

  const tempName = `.sandbox-write-${process.pid}-${randomBytes(8).toString("hex")}.tmp`;
  const tempPath = path.join(parent, tempName);

  try {
    await writeFile(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
    });

    const handle = await open(tempPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(tempPath, resolved.absolutePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }

  return {
    path: resolved.relativePath,
    bytes,
  };
}

/**
 * @param {object} context
 * @param {string} inputPath
 */
export async function deleteFile(context, inputPath) {
  const resolved = await resolveForDelete(context, inputPath);
  await rm(resolved.absolutePath, { force: false });
  return /** @type {{ path: string; deleted: true }} */ ({
    path: resolved.relativePath,
    deleted: true,
  });
}

/**
 * @param {object} context
 * @param {string} [inputPath]
 */
export async function listDirectory(context, inputPath = ".") {
  const resolved = await resolveForList(context, inputPath);
  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  const items = await readdir(resolved.absolutePath, { withFileTypes: true });
  const entries = [];

  for (const item of items) {
    if (BLOCKED_SEGMENTS.has(item.name)) {
      continue;
    }

    if (item.isSymbolicLink()) {
      continue;
    }

    const childRelative =
      resolved.relativePath === "."
        ? item.name
        : `${resolved.relativePath}/${item.name}`;

    const sensitivity = evaluateSensitivePath(childRelative, "read");
    if (!sensitivity.allowed && !READ_ONLY_EXCEPTIONS.has(item.name)) {
      continue;
    }

    entries.push({
      name: item.name,
      type: /** @type {"directory" | "file"} */ (
        item.isDirectory() ? "directory" : "file"
      ),
      path: childRelative,
    });

    if (entries.length >= limits.maxListEntries) {
      break;
    }
  }

  return {
    directory: resolved.relativePath,
    entries,
    truncated: items.length > entries.length,
  };
}

/**
 * @param {object} context
 * @param {{
 *   query: string;
 *   directory?: string;
 *   maxResults?: number;
 *   signal?: AbortSignal;
 * }} options
 */
export async function searchFiles(context, options) {
  const query = typeof options?.query === "string" ? options.query.trim() : "";
  if (!query) {
    fail(ErrorCodes.PATH_INVALID, "Search query cannot be empty");
  }

  const limits = { ...DEFAULT_LIMITS, ...(context.limits ?? {}) };
  const maxResults = Math.min(
    Math.max(options.maxResults ?? limits.maxSearchResults, 1),
    limits.maxSearchResults
  );

  const root = await resolveForList(context, options.directory ?? ".");
  const matches = [];
  let scannedFiles = 0;
  let totalReadBytes = 0;
  let truncated = false;

  /**
   * @param {string} absoluteDir
   * @param {string} relativeDir
   * @param {number} depth
   */
  async function walk(absoluteDir, relativeDir, depth) {
    if (truncated || matches.length >= maxResults) {
      return;
    }

    if (options.signal?.aborted) {
      fail(ErrorCodes.LIMIT_EXCEEDED, "Search was cancelled");
    }

    if (depth > limits.maxSearchDepth) {
      truncated = true;
      return;
    }

    const items = await readdir(absoluteDir, { withFileTypes: true });

    for (const item of items) {
      if (truncated || matches.length >= maxResults) {
        truncated = true;
        return;
      }

      if (BLOCKED_SEGMENTS.has(item.name) || item.isSymbolicLink()) {
        continue;
      }

      const childRelative =
        relativeDir === "." ? item.name : `${relativeDir}/${item.name}`;
      const childAbsolute = path.join(absoluteDir, item.name);

      if (item.isDirectory()) {
        await walk(childAbsolute, childRelative, depth + 1);
        continue;
      }

      if (!item.isFile()) {
        continue;
      }

      const sensitivity = evaluateSensitivePath(childRelative, "read");
      if (!sensitivity.allowed && !READ_ONLY_EXCEPTIONS.has(item.name)) {
        continue;
      }

      scannedFiles += 1;
      if (scannedFiles > limits.maxSearchFilesScanned) {
        truncated = true;
        return;
      }

      if (childRelative.includes(query)) {
        matches.push(childRelative);
        continue;
      }

      if (!isTextLikeFile(childRelative)) {
        continue;
      }

      let info;
      try {
        info = await stat(childAbsolute);
      } catch {
        continue;
      }

      if (info.size > limits.maxSearchFileBytes) {
        continue;
      }

      if (totalReadBytes + info.size > limits.maxSearchTotalReadBytes) {
        truncated = true;
        return;
      }

      try {
        const content = await readFile(childAbsolute, "utf8");
        totalReadBytes += Buffer.byteLength(content, "utf8");
        if (content.includes(query)) {
          matches.push(childRelative);
        }
      } catch {
        // Ignore unreadable/non-text files.
      }
    }
  }

  await walk(root.absolutePath, root.relativePath, 0);

  return {
    query,
    directory: root.relativePath,
    matches: matches.slice(0, maxResults),
    truncated: truncated || matches.length > maxResults,
    scannedFiles,
  };
}

/**
 * Sync-friendly logical validation used by callers that only need path checks
 * before handing work to another tool (e.g. rg). Does not touch the filesystem
 * beyond using the already-canonical workspaceRoot from context.
 *
 * @param {object} context
 * @param {string} inputPath
 * @param {{ allowRoot?: boolean; access?: "read" | "write" | "delete" }} [options]
 */
export function validateWorkspacePath(context, inputPath, options = {}) {
  return resolveLogicalPath(context, inputPath, {
    allowRoot: options.allowRoot ?? true,
    access: options.access ?? "read",
  });
}
