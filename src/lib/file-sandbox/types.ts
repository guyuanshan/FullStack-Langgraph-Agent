export type FileSandboxAccess = "read" | "write" | "delete";

export type FileSandboxLimits = {
  maxPathLength: number;
  maxReadBytes: number;
  maxWriteBytes: number;
  maxListEntries: number;
  maxSearchDepth: number;
  maxSearchFilesScanned: number;
  maxSearchResults: number;
  maxSearchFileBytes: number;
  maxSearchTotalReadBytes: number;
};

export type FileSandboxContext = {
  tenantId: string;
  runId: string;
  workspaceRoot: string;
  access: FileSandboxAccess;
  limits?: Partial<FileSandboxLimits>;
};

export type ResolvedSandboxPath = {
  absolutePath: string;
  relativePath: string;
  access: FileSandboxAccess;
  size?: number;
};

export type ReadTextResult = {
  path: string;
  content: string;
  bytes: number;
};

export type WriteTextResult = {
  path: string;
  bytes: number;
};

export type DeleteFileResult = {
  path: string;
  deleted: true;
};

export type DirectoryEntry = {
  name: string;
  type: "file" | "directory";
  path: string;
};

export type ListDirectoryResult = {
  directory: string;
  entries: DirectoryEntry[];
  truncated: boolean;
};

export type SearchFilesOptions = {
  query: string;
  directory?: string;
  maxResults?: number;
  signal?: AbortSignal;
};

export type SearchFilesResult = {
  query: string;
  directory: string;
  matches: string[];
  truncated: boolean;
  scannedFiles: number;
};

export type FileSandboxErrorCode =
  | "PATH_EMPTY"
  | "PATH_INVALID"
  | "PATH_TOO_LONG"
  | "PATH_ABSOLUTE"
  | "PATH_OUTSIDE_WORKSPACE"
  | "SENSITIVE_PATH"
  | "ACCESS_DENIED"
  | "SYMLINK_DENIED"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "FILE_TOO_LARGE"
  | "LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "WORKSPACE_INVALID";
