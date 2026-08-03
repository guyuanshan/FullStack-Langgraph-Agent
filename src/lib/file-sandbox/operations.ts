import {
  deleteFile as coreDeleteFile,
  listDirectory as coreListDirectory,
  readText as coreReadText,
  searchFiles as coreSearchFiles,
  writeText as coreWriteText,
} from "./core.mjs";
import type {
  DeleteFileResult,
  FileSandboxContext,
  ListDirectoryResult,
  ReadTextResult,
  SearchFilesOptions,
  SearchFilesResult,
  WriteTextResult,
} from "./types";

export function readText(
  context: FileSandboxContext,
  inputPath: string
): Promise<ReadTextResult> {
  return coreReadText(context, inputPath);
}

export function writeText(
  context: FileSandboxContext,
  inputPath: string,
  content: string
): Promise<WriteTextResult> {
  return coreWriteText(context, inputPath, content);
}

export function deleteFile(
  context: FileSandboxContext,
  inputPath: string
): Promise<DeleteFileResult> {
  return coreDeleteFile(context, inputPath) as Promise<DeleteFileResult>;
}

export function listDirectory(
  context: FileSandboxContext,
  inputPath = "."
): Promise<ListDirectoryResult> {
  return coreListDirectory(context, inputPath) as Promise<ListDirectoryResult>;
}

export function searchFiles(
  context: FileSandboxContext,
  options: SearchFilesOptions
): Promise<SearchFilesResult> {
  return coreSearchFiles(context, options);
}
