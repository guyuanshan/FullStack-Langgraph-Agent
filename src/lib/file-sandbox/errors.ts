import {
  ErrorCodes as CoreErrorCodes,
  FileSandboxError as CoreFileSandboxError,
} from "./core.mjs";
import type { FileSandboxErrorCode } from "./types";

export const ErrorCodes = CoreErrorCodes as Readonly<
  Record<FileSandboxErrorCode, FileSandboxErrorCode>
>;

export class FileSandboxError extends Error {
  readonly code: FileSandboxErrorCode;

  constructor(code: FileSandboxErrorCode, message: string) {
    super(message);
    this.name = "FileSandboxError";
    this.code = code;
  }
}

export function isFileSandboxError(error: unknown): error is FileSandboxError {
  return (
    error instanceof FileSandboxError ||
    error instanceof CoreFileSandboxError ||
    (!!error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "FileSandboxError" &&
      typeof (error as { code?: unknown }).code === "string")
  );
}

export function getFileSandboxErrorCode(error: unknown): FileSandboxErrorCode | null {
  if (!isFileSandboxError(error)) {
    return null;
  }

  return (error as { code: FileSandboxErrorCode }).code;
}

export function toFileSandboxErrorMessage(error: unknown): string {
  if (isFileSandboxError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "File sandbox operation failed";
}
