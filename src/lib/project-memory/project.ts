import path from "node:path";
import { createHash } from "node:crypto";
import { WORKSPACE_ROOT } from "../code-agent/workspace";

export function getProjectId() {
  return createHash("sha1").update(WORKSPACE_ROOT).digest("hex").slice(0, 16);
}

export function getProjectLabel() {
  return path.basename(WORKSPACE_ROOT);
}
