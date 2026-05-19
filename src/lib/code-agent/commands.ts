import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendToolAuditLog } from "../audit/log";
import { WORKSPACE_ROOT } from "./workspace";

const execFileAsync = promisify(execFile);

type ProjectCheckName = "lint" | "typecheck" | "test";

const CHECK_COMMANDS: Record<ProjectCheckName, [string, string[]]> = {
  lint: ["pnpm", ["lint"]],
  typecheck: ["pnpm", ["exec", "tsc", "--noEmit"]],
  test: ["pnpm", ["test"]],
};

export async function runProjectChecks(options: {
  checks: ProjectCheckName[];
}) {
  if (!Array.isArray(options.checks) || options.checks.length === 0) {
    throw new Error("At least one check is required");
  }

  const results = [];

  for (const check of options.checks) {
    const command = CHECK_COMMANDS[check];

    if (!command) {
      throw new Error(`Unsupported project check: ${check}`);
    }

    const [bin, args] = command;
    const startedAt = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(bin, args, {
        cwd: WORKSPACE_ROOT,
        maxBuffer: 1024 * 1024 * 8,
      });

      const result = {
        check,
        ok: true,
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      };

      results.push(result);
      continue;
    } catch (error) {
      const candidate = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      results.push({
        check,
        ok: false,
        exitCode: typeof candidate.code === "number" ? candidate.code : -1,
        durationMs: Date.now() - startedAt,
        stdout: candidate.stdout ?? "",
        stderr: candidate.stderr ?? candidate.message ?? "",
      });
    }
  }

  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
    toolName: "run_project_checks",
    source: "local",
    riskLevel: "confirm_required",
    permissions: ["execute"],
    args: options,
    outcome: results.every((result) => result.ok) ? "success" : "error",
    resultSummary: results
      .map((result) => `${result.check}:${result.ok ? "ok" : "failed"}`)
      .join(", "),
    detail: JSON.stringify(results),
  });

  return {
    kind: "project_check_results",
    results,
  };
}
