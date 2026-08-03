import type { AuthContext } from "../auth/tenant-resolution";
import {
  getRunTrace as getTenantRunTrace,
  listSessionRuns as listTenantSessionRuns,
} from "../db/tenant-access";

/**
 * @deprecated Prefer importing from `../db/tenant-access` directly.
 * Bare-ID overloads are removed; all reads require AuthContext.
 */
export async function listSessionRuns(auth: AuthContext, sessionId: string) {
  return listTenantSessionRuns(auth, sessionId);
}

/**
 * @deprecated Prefer importing from `../db/tenant-access` directly.
 * Bare-ID overloads are removed; all reads require AuthContext.
 */
export async function getRunTrace(auth: AuthContext, runId: string) {
  return getTenantRunTrace(auth, runId);
}
