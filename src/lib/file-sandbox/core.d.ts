import type {
  DeleteFileResult,
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

export const ErrorCodes: Readonly<Record<FileSandboxErrorCode, FileSandboxErrorCode>>;

export const DEFAULT_LIMITS: Readonly<FileSandboxLimits>;

export class FileSandboxError extends Error {
  code: FileSandboxErrorCode;
  constructor(code: FileSandboxErrorCode, message: string);
}

export function resolveConfiguredWorkspaceRoot(): string;

export function canonicalizeWorkspaceRoot(workspaceRoot: string): Promise<string>;

export function createFileSandboxContext(options: {
  tenantId: string;
  runId: string;
  workspaceRoot: string;
  access?: FileSandboxAccess;
  limits?: Partial<FileSandboxLimits> | Record<string, number>;
}): Promise<FileSandboxContext>;

export function createDefaultFileSandboxContext(options?: {
  tenantId?: string;
  runId?: string;
  access?: FileSandboxAccess;
  limits?: Partial<FileSandboxLimits> | Record<string, number>;
}): Promise<FileSandboxContext>;

export function isBlockedPathSegment(segment: string): boolean;

export function isTextLikeFile(filePath: string): boolean;

export function evaluateSensitivePath(
  relativePath: string,
  access: FileSandboxAccess
): { allowed: boolean; reason: string | null };

export function resolveLogicalPath(
  context: FileSandboxContext,
  inputPath: string,
  options: { allowRoot?: boolean; access: FileSandboxAccess }
): ResolvedSandboxPath;

export function resolveForRead(
  context: FileSandboxContext,
  inputPath: string
): Promise<ResolvedSandboxPath>;

export function resolveForWrite(
  context: FileSandboxContext,
  inputPath: string
): Promise<ResolvedSandboxPath>;

export function resolveForDelete(
  context: FileSandboxContext,
  inputPath: string
): Promise<ResolvedSandboxPath>;

export function resolveForList(
  context: FileSandboxContext,
  inputPath?: string
): Promise<ResolvedSandboxPath>;

export function readText(
  context: FileSandboxContext,
  inputPath: string
): Promise<ReadTextResult>;

export function writeText(
  context: FileSandboxContext,
  inputPath: string,
  content: string
): Promise<WriteTextResult>;

export function deleteFile(
  context: FileSandboxContext,
  inputPath: string
): Promise<DeleteFileResult>;

export function listDirectory(
  context: FileSandboxContext,
  inputPath?: string
): Promise<ListDirectoryResult>;

export function searchFiles(
  context: FileSandboxContext,
  options: SearchFilesOptions
): Promise<SearchFilesResult>;

export function validateWorkspacePath(
  context: FileSandboxContext,
  inputPath: string,
  options?: { allowRoot?: boolean; access?: FileSandboxAccess }
): ResolvedSandboxPath;
