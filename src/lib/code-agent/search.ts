import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDefaultSandboxContext, WORKSPACE_ROOT } from "./workspace";
import { validateWorkspacePath } from "../file-sandbox";

const execFileAsync = promisify(execFile);

type SearchMode = "auto" | "filename" | "content" | "symbol" | "semantic";
//

function baseIgnoreArgs() {
  return [
    "-g",
    "!node_modules",
    "-g",
    "!.git",
    "-g",
    "!.next",
    "-g",
    "!.demo-output",
  ];
}

function parseContentSearch(stdout: string, maxResults: number) {
  return stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, maxResults)
    .map((line) => {
      const [filePath = "", lineNumber = "", preview = ""] = line.split(":", 3);
      return {
        path: filePath,
        line: Number.parseInt(lineNumber, 10) || null,
        preview,
      };
    });
}

function tokenizeQuery(query: string) {
  return [...new Set(query.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [])].filter(
    (token) => token.length >= 2
  );
}

async function runSemanticSearch(
  query: string,
  directory: string,
  maxResults: number
) {
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) {
    return [];
  }

  const scoreMap = new Map<
    string,
    {
      score: number;
      line: number | null;
      preview: string;
    }
  >();

  for (const token of tokens) {
    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "-n",
          "--no-heading",
          "-i",
          "--max-count",
          "3",
          ...baseIgnoreArgs(),
          token,
          directory,
        ],
        {
          cwd: WORKSPACE_ROOT,
          maxBuffer: 1024 * 1024,
        }
      );

      for (const match of parseContentSearch(stdout, maxResults * 5)) {
        const previous = scoreMap.get(match.path);
        const filenameBoost = match.path.toLowerCase().includes(token) ? 2 : 0;
        const nextScore = (previous?.score ?? 0) + 1 + filenameBoost;

        scoreMap.set(match.path, {
          score: nextScore,
          line: previous?.line ?? match.line,
          preview: previous?.preview ?? match.preview,
        });
      }
    } catch (error) {
      const candidate = error as { code?: number };

      if (candidate.code !== 1) {
        throw error;
      }
    }
  }

  return [...scoreMap.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, maxResults)
    .map(([path, value]) => ({
      path,
      line: value.line,
      preview: value.preview,
      score: value.score,
    }));
}

export async function searchProjectCode(options: {
  query: string;
  mode?: SearchMode;
  maxResults?: number;
  directory?: string;
}) {
  const mode = options.mode ?? "auto";
  const maxResults = Math.min(Math.max(options.maxResults ?? 10, 1), 50);
  const query = options.query.trim();
  const sandbox = getDefaultSandboxContext("read");
  const directory = options.directory
    ? validateWorkspacePath(sandbox, options.directory, {
        allowRoot: true,
        access: "read",
      }).relativePath
    : ".";

  if (!query) {
    throw new Error("Search query cannot be empty");
  }

  if (mode === "filename") {
    const { stdout } = await execFileAsync(
      "rg",
      [
        "--files",
        directory,
        ...baseIgnoreArgs(),
      ],
      { cwd: WORKSPACE_ROOT, maxBuffer: 1024 * 1024 }
    );

    const loweredQuery = query.toLowerCase();
    const results = stdout
      .split("\n")
      .filter(Boolean)
      .filter((value) => value.toLowerCase().includes(loweredQuery))
      .slice(0, maxResults)
      .map((path) => ({ path }));

    return {
      kind: "project_search",
      mode,
      query,
      directory,
      results,
    };
  }

  if (mode === "semantic") {
    return {
      kind: "project_search",
      mode,
      query,
      directory,
      results: await runSemanticSearch(query, directory, maxResults),
    };
  }

  const isSymbolMode = mode === "symbol";
  const searchArgs = [
    "-n",
    "--no-heading",
    "--max-count",
    String(maxResults),
    ...(isSymbolMode ? ["-g", "*.{ts,tsx,js,jsx,mjs,cjs}"] : []),
    ...baseIgnoreArgs(),
    query,
    directory,
  ];

  try {
    const { stdout } = await execFileAsync("rg", searchArgs, {
      cwd: WORKSPACE_ROOT,
      maxBuffer: 1024 * 1024,
    });

    return {
      kind: "project_search",
      mode,
      query,
      directory,
      results: parseContentSearch(stdout, maxResults),
    };
  } catch (error) {
    const candidate = error as { code?: number; stdout?: string };

    if (candidate.code === 1) {
      return {
        kind: "project_search",
        mode,
        query,
        directory,
        results: [],
      };
    }

    throw error;
  }
}
