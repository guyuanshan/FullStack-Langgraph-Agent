export function summarizeToolArgs(args: Record<string, unknown>) {//
  if (typeof args.url === "string" && typeof args.selector === "string") {
    return `${args.url} · ${args.selector}`;
  }

  if (typeof args.url === "string") {
    return args.url;
  }

  const repo =
    typeof args.repo === "string"
      ? args.repo
      : typeof args.repository === "string"
        ? args.repository
        : undefined;
  const pathValue =
    typeof args.path === "string"
      ? args.path
      : typeof args.filePath === "string"
        ? args.filePath
        : undefined;

  if (repo && pathValue) {
    return `${repo}:${pathValue}`;
  }

  if (repo && typeof args.title === "string") {
    return `${repo} · ${args.title}`;
  }

  if (repo && typeof args.query === "string") {
    return `${repo} · ${args.query}`;
  }

  if (repo) {
    return repo;
  }

  if (typeof args.directory === "string") {
    return args.directory;
  }

  if (typeof args.branchName === "string") {
    return args.branchName;
  }

  if (typeof args.baseRef === "string") {
    return args.baseRef;
  }

  if (typeof args.message === "string") {
    return args.message;
  }

  if (Array.isArray(args.paths)) {
    return `${args.paths.length} file(s)`;
  }

  if (Array.isArray(args.checks)) {
    return args.checks.join(", ");
  }

  if (typeof args.filename === "string") {
    return args.filename;
  }

  if (typeof args.city === "string") {
    return args.city;
  }

  if (typeof args.query === "string") {
    return args.query;
  }

  if (typeof args.selector === "string") {
    return args.selector;
  }

  return undefined;
}

export function getResultLink(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.htmlUrl === "string") {
    return candidate.htmlUrl;
  }

  if (typeof candidate.url === "string") {
    return candidate.url;
  }

  return undefined;
}

export function getResultUrl(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.url === "string" ? candidate.url : undefined;
}

export function summarizeToolResult(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.title === "string" && typeof candidate.url === "string") {
    return `${candidate.title} · ${candidate.url}`;
  }

  if (candidate.kind === "patch_proposal" && typeof candidate.proposalId === "string") {
    const files = Array.isArray(candidate.files) ? candidate.files.length : 0;
    return `${candidate.proposalId} · ${files} file(s)`;
  }

  if (
    candidate.kind === "git_status_summary" &&
    Array.isArray(candidate.changedFiles)
  ) {
    return `branch:${String(candidate.branch ?? "unknown")} · ${candidate.changedFiles.length} changed`;
  }

  if (candidate.kind === "git_branch_result" && typeof candidate.branch === "string") {
    return candidate.branch;
  }

  if (candidate.kind === "git_commit_result" && typeof candidate.commit === "string") {
    return `${candidate.commit.slice(0, 7)} · ${String(candidate.message ?? "")}`;
  }

  if (candidate.kind === "git_push_result" && typeof candidate.branch === "string") {
    return `${String(candidate.remote ?? "origin")} · ${candidate.branch}`;
  }

  if (candidate.kind === "git_pr_summary" && typeof candidate.suggestedTitle === "string") {
    return candidate.suggestedTitle;
  }

  if (
    candidate.kind === "patch_apply_result" &&
    typeof candidate.proposalId === "string"
  ) {
    return `${candidate.proposalId} · ${String(candidate.status ?? "unknown")}`;
  }

  if (candidate.kind === "project_check_results" && Array.isArray(candidate.results)) {
    return candidate.results
      .map((result) => {
        const item =
          result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : null;
        const check = typeof item?.check === "string" ? item.check : "unknown";
        const ok = item?.ok === true;
        return `${check}:${ok ? "ok" : "failed"}`;
      })
      .join(", ");
  }

  if (Array.isArray(candidate.links)) {
    return `links:${candidate.links.length}`;
  }

  if (typeof candidate.filePath === "string" && typeof candidate.bytes === "number") {
    return `${candidate.filePath} · ${candidate.bytes} bytes`;
  }

  if (typeof candidate.htmlUrl === "string") {
    return candidate.htmlUrl;
  }

  if (typeof candidate.url === "string") {
    return candidate.url;
  }

  return undefined;
}
