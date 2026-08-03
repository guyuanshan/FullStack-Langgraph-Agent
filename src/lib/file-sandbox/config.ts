import { realpathSync } from "node:fs";
import {
  DEFAULT_LIMITS as CORE_DEFAULT_LIMITS,
  canonicalizeWorkspaceRoot,
  createDefaultFileSandboxContext,
  createFileSandboxContext,
  resolveConfiguredWorkspaceRoot,
} from "./core.mjs";
import type {
  FileSandboxAccess,
  FileSandboxContext,
  FileSandboxLimits,
} from "./types";

export const DEFAULT_LIMITS: Readonly<FileSandboxLimits> = CORE_DEFAULT_LIMITS;

export {
  canonicalizeWorkspaceRoot,
  createDefaultFileSandboxContext,
  createFileSandboxContext,
  resolveConfiguredWorkspaceRoot,
};

/**
 * Cached default workspace root for local/single-process mode.
 * Section 4.2 will replace cwd fallback with a required AGENT_WORKSPACE_BASE.
 */
let cachedWorkspaceRoot: string | null = null;

export function getWorkspaceRoot(): string {
  if (!cachedWorkspaceRoot) {
    const configured = resolveConfiguredWorkspaceRoot();
    try {
      cachedWorkspaceRoot = realpathSync(configured);
    } catch {
      cachedWorkspaceRoot = configured;
    }
  }

  return cachedWorkspaceRoot;
}

/** @internal test helper */
export function __resetWorkspaceRootCacheForTests() {
  cachedWorkspaceRoot = null;
}

export async function getFileSandboxContext(options?: {
  tenantId?: string;
  runId?: string;
  access?: FileSandboxAccess;
  limits?: Partial<FileSandboxLimits>;
}): Promise<FileSandboxContext> {
  return createDefaultFileSandboxContext({
    tenantId: options?.tenantId,
    runId: options?.runId,
    access: options?.access,
    limits: options?.limits as Partial<FileSandboxLimits> | undefined,
  });
}

export async function getFileSandboxContextForRoot(
  workspaceRoot: string,
  options?: {
    tenantId?: string;
    runId?: string;
    access?: FileSandboxAccess;
    limits?: Partial<FileSandboxLimits>;
  }
): Promise<FileSandboxContext> {
  return createFileSandboxContext({
    tenantId: options?.tenantId ?? "default",
    runId: options?.runId ?? "local",
    workspaceRoot,
    access: options?.access ?? "read",
    limits: options?.limits as Partial<FileSandboxLimits> | undefined,
  });
}
