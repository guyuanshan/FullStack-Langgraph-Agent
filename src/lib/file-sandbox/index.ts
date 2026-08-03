export {
  DEFAULT_LIMITS,
  __resetWorkspaceRootCacheForTests,
  canonicalizeWorkspaceRoot,
  createDefaultFileSandboxContext,
  createFileSandboxContext,
  getFileSandboxContext,
  getFileSandboxContextForRoot,
  getWorkspaceRoot,
  resolveConfiguredWorkspaceRoot,
} from "./config";
export {
  ErrorCodes,
  FileSandboxError,
  getFileSandboxErrorCode,
  isFileSandboxError,
  toFileSandboxErrorMessage,
} from "./errors";
export {
  deleteFile,
  listDirectory,
  readText,
  searchFiles,
  writeText,
} from "./operations";
export {
  evaluateSensitivePath,
  isBlockedPathSegment,
  isTextLikeFile,
  resolveForDelete,
  resolveForList,
  resolveForRead,
  resolveForWrite,
  resolveLogicalPath,
  validateWorkspacePath,
} from "./path-policy";
export type {
  DeleteFileResult,
  DirectoryEntry,
  FileSandboxAccess,
  FileSandboxContext,
  FileSandboxErrorCode,
  FileSandboxLimits,
  ListDirectoryResult,
  ReadTextResult,
  ResolvedSandboxPath,
  SearchFilesOptions,
  SearchFilesResult,
  WriteTextResult,
} from "./types";
