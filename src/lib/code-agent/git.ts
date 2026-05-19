import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WORKSPACE_ROOT, validateWorkspacePath } from "./workspace";

const execFileAsync = promisify(execFile);

async function runGitCommand(args: string[]) {
  return execFileAsync("git", args, {
    cwd: WORKSPACE_ROOT,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export async function getGitStatusSummary() {
  const [{ stdout: branchStdout }, { stdout: statusStdout }, { stdout: diffStdout }] =
    await Promise.all([
      runGitCommand(["branch", "--show-current"]),
      runGitCommand(["status", "--short"]),
      runGitCommand(["diff", "--stat"]),
    ]);

  const changedFiles = splitLines(statusStdout).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3),
  }));

  return {
    kind: "git_status_summary",
    branch: branchStdout.trim() || null,
    changedFiles,
    diffStat: splitLines(diffStdout),
  };
}

export async function createGitBranch(options: {
  branchName: string;
  fromRef?: string;
}) {
  const branchName = options.branchName.trim();

  if (!branchName) {
    throw new Error("Branch name is required");
  }

  const args = options.fromRef?.trim()
    ? ["switch", "-c", branchName, options.fromRef.trim()]
    : ["switch", "-c", branchName];

  await runGitCommand(args);

  return {
    kind: "git_branch_result",
    branch: branchName,
    fromRef: options.fromRef?.trim() || null,
    created: true,
  };
}

export async function createGitCommit(options: {
  message: string;
  paths?: string[];
}) {
  const message = options.message.trim();

  if (!message) {
    throw new Error("Commit message is required");
  }

  const validatedPaths =
    options.paths?.map((input) => validateWorkspacePath(input).relativePath) ?? [];

  if (validatedPaths.length > 0) {
    await runGitCommand(["add", "--", ...validatedPaths]);
  }

  try {
    const { stdout } = await runGitCommand(["commit", "-m", message]);
    const { stdout: shaStdout } = await runGitCommand(["rev-parse", "HEAD"]);

    return {
      kind: "git_commit_result",
      commit: shaStdout.trim(),
      message,
      paths: validatedPaths,
      output: stdout.trim(),
    };
  } catch (error) {
    const candidate = error as { stderr?: string; stdout?: string };
    const detail = `${candidate.stdout ?? ""}\n${candidate.stderr ?? ""}`.trim();
    throw new Error(detail || "git commit failed");
  }
}

export async function pushGitBranch(options: {
  remote?: string;
  branchName?: string;
}) {
  const remote = options.remote?.trim() || "origin";
  const branchName =
    options.branchName?.trim() ||
    (await runGitCommand(["branch", "--show-current"])).stdout.trim();

  if (!branchName) {
    throw new Error("Branch name is required to push");
  }

  const { stdout } = await runGitCommand(["push", "-u", remote, branchName]);

  return {
    kind: "git_push_result",
    remote,
    branch: branchName,
    output: stdout.trim(),
  };
}

export async function buildPullRequestSummary(options?: { baseRef?: string }) {
  const baseRef = options?.baseRef?.trim() || "main";
  const [
    { stdout: branchStdout },
    { stdout: diffStatStdout },
    { stdout: commitsStdout },
  ] = await Promise.all([
    runGitCommand(["branch", "--show-current"]),
    runGitCommand(["diff", "--stat", `${baseRef}...HEAD`]),
    runGitCommand(["log", "--oneline", `${baseRef}..HEAD`]),
  ]);

  const branch = branchStdout.trim();
  const commitLines = splitLines(commitsStdout);
  const diffLines = splitLines(diffStatStdout);
  const suggestedTitle =
    commitLines[0]?.replace(/^[a-f0-9]+\s+/, "") || `Update ${branch || "branch"}`;
  const summaryLines = [
    `## Summary`,
    "",
    `- Branch: \`${branch || "unknown"}\``,
    `- Base: \`${baseRef}\``,
    "",
    `## Changes`,
    "",
    ...(diffLines.length > 0 ? diffLines.map((line) => `- ${line}`) : ["- No diff stat available"]),
    "",
    `## Commits`,
    "",
    ...(commitLines.length > 0 ? commitLines.map((line) => `- ${line}`) : ["- No commits yet"]),
  ];

  return {
    kind: "git_pr_summary",
    branch,
    baseRef,
    suggestedTitle,
    summary: summaryLines.join("\n"),
    commits: commitLines,
    diffStat: diffLines,
  };
}
