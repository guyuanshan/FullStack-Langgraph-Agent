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
