import {
  getWorkspaceRoot,
  isBlockedPathSegment,
  isTextLikeFile,
  validateWorkspacePath as validateSandboxPath,
  type FileSandboxContext,
} from "../file-sandbox";

/**
 * Compatibility surface for Code Agent modules.
 * Path policy lives solely in `src/lib/file-sandbox`.
 */
export const WORKSPACE_ROOT = getWorkspaceRoot();

export { isBlockedPathSegment, isTextLikeFile };

function defaultContext(access: FileSandboxContext["access"] = "read"): FileSandboxContext {
  return {
    tenantId: "default",
    runId: "local",
    workspaceRoot: WORKSPACE_ROOT,
    access,
  };
}

export function validateWorkspacePath(input: string) {
  const resolved = validateSandboxPath(defaultContext("read"), input, {
    allowRoot: true,
    access: "read",
  });

  return {
    absolutePath: resolved.absolutePath,
    relativePath: resolved.relativePath,
  };
}

export function toDisplayPath(input: string) {
  return validateWorkspacePath(input).relativePath;
}

export function getDefaultSandboxContext(
  access: FileSandboxContext["access"] = "read"
): FileSandboxContext {
  return defaultContext(access);
}
