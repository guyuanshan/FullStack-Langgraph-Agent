import {
  evaluateSensitivePath as coreEvaluateSensitivePath,
  isBlockedPathSegment as coreIsBlockedPathSegment,
  isTextLikeFile as coreIsTextLikeFile,
  resolveForDelete as coreResolveForDelete,
  resolveForList as coreResolveForList,
  resolveForRead as coreResolveForRead,
  resolveForWrite as coreResolveForWrite,
  resolveLogicalPath as coreResolveLogicalPath,
  validateWorkspacePath as coreValidateWorkspacePath,
} from "./core.mjs";
import type {
  FileSandboxAccess,
  FileSandboxContext,
  ResolvedSandboxPath,
} from "./types";

export const isBlockedPathSegment = coreIsBlockedPathSegment;
export const isTextLikeFile = coreIsTextLikeFile;
export const evaluateSensitivePath = coreEvaluateSensitivePath;

export function resolveLogicalPath(
  context: FileSandboxContext,
  inputPath: string,
  options: { allowRoot?: boolean; access: FileSandboxAccess }
): ResolvedSandboxPath {
  return coreResolveLogicalPath(context, inputPath, options);
}

export function resolveForRead(
  context: FileSandboxContext,
  inputPath: string
): Promise<ResolvedSandboxPath> {
  return coreResolveForRead(context, inputPath);
}

export function resolveForWrite(
  context: FileSandboxContext,
  inputPath: string
): Promise<ResolvedSandboxPath> {
  return coreResolveForWrite(context, inputPath);
}

export function resolveForDelete(
  context: FileSandboxContext,
  inputPath: string
): Promise<ResolvedSandboxPath> {
  return coreResolveForDelete(context, inputPath);
}

export function resolveForList(
  context: FileSandboxContext,
  inputPath = "."
): Promise<ResolvedSandboxPath> {
  return coreResolveForList(context, inputPath);
}

/**
 * Logical path validation against an already-canonical context.workspaceRoot.
 * Prefer resolveForRead/Write/Delete when performing real filesystem I/O.
 */
export function validateWorkspacePath(
  context: FileSandboxContext,
  inputPath: string,
  options?: { allowRoot?: boolean; access?: FileSandboxAccess }
): ResolvedSandboxPath {
  return coreValidateWorkspacePath(context, inputPath, options);
}
