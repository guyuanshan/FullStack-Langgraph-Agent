import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createUnifiedDiff(
  relativePath: string,
  previousContent: string,
  nextContent: string
) {
  if (previousContent === nextContent) {
    return "";
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "code-agent-diff-"));
  const beforePath = path.join(tempDir, "before.txt");
  const afterPath = path.join(tempDir, "after.txt");

  try {
    await writeFile(beforePath, previousContent, "utf8");
    await writeFile(afterPath, nextContent, "utf8");

    try {
      const { stdout } = await execFileAsync("diff", [
        "-u",
        "-L",
        `a/${relativePath}`,
        "-L",
        `b/${relativePath}`,
        beforePath,
        afterPath,
      ]);

      return stdout;
    } catch (error) {
      const candidate = error as { code?: number; stdout?: string };

      if (candidate.code === 1) {
        return candidate.stdout ?? "";
      }

      throw error;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
