import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isTextLikeFile, isBlockedPathSegment, WORKSPACE_ROOT } from "./workspace";

const DEFAULT_SCAN_LIMIT = 400;
const DEFAULT_MAX_FILE_CHARS = 4000;

type ProjectFileSummary = {
  path: string;
  size: number;
};

function detectPackageManager() {
  if (process.env.npm_config_user_agent?.includes("pnpm")) {
    return "pnpm";
  }

  return "npm";
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextFileIfExists(relativePath: string, maxChars = DEFAULT_MAX_FILE_CHARS) {
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);

  if (!(await fileExists(absolutePath))) {
    return null;
  }

  const content = await readFile(absolutePath, "utf8");
  return content.length > maxChars
    ? `${content.slice(0, maxChars)}\n...<truncated>`
    : content;
}

async function collectFiles(
  directoryPath: string,
  rootRelativePath = "",
  results: ProjectFileSummary[] = []
) {
  if (results.length >= DEFAULT_SCAN_LIMIT) {
    return results;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= DEFAULT_SCAN_LIMIT) {
      break;
    }

    if (entry.name.startsWith(".DS_Store")) {
      continue;
    }

    if (isBlockedPathSegment(entry.name)) {
      continue;
    }

    const nextRelativePath = rootRelativePath
      ? `${rootRelativePath}/${entry.name}`
      : entry.name;
    const nextAbsolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(nextAbsolutePath, nextRelativePath, results);
      continue;
    }

    if (!entry.isFile() || !isTextLikeFile(nextRelativePath)) {
      continue;
    }

    const fileStat = await stat(nextAbsolutePath);
    results.push({
      path: nextRelativePath,
      size: fileStat.size,
    });
  }

  return results;
}

function detectTechStack(packageJson: Record<string, unknown>) {
  const deps = {
    ...(typeof packageJson.dependencies === "object" && packageJson.dependencies
      ? (packageJson.dependencies as Record<string, unknown>)
      : {}),
    ...(typeof packageJson.devDependencies === "object" &&
    packageJson.devDependencies
      ? (packageJson.devDependencies as Record<string, unknown>)
      : {}),
  };

  const stack = new Set<string>();

  if (deps.next) stack.add("Next.js");
  if (deps.react) stack.add("React");
  if (deps.typescript) stack.add("TypeScript");
  if (deps["@langchain/langgraph"]) stack.add("LangGraph");
  if (deps["@modelcontextprotocol/sdk"]) stack.add("MCP");
  if (deps.ai) stack.add("AI SDK");
  if (deps.playwright) stack.add("Playwright");
  if (deps.zod) stack.add("Zod");

  return [...stack];
}

export async function buildProjectSummary() {
  const packageJsonText = await readTextFileIfExists("package.json");
  const tsconfigText = await readTextFileIfExists("tsconfig.json");
  const readmeText = await readTextFileIfExists("README.md", 6000);
  const topLevelEntries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
  const indexedFiles = await collectFiles(WORKSPACE_ROOT);
  const packageJson = packageJsonText ? (JSON.parse(packageJsonText) as Record<string, unknown>) : {};
  const scripts =
    typeof packageJson.scripts === "object" && packageJson.scripts
      ? packageJson.scripts
      : {};

  return {
    kind: "project_summary",
    name:
      typeof packageJson.name === "string" ? packageJson.name : path.basename(WORKSPACE_ROOT),
    packageManager: detectPackageManager(),
    stack: detectTechStack(packageJson),
    scripts,
    topLevelDirectories: topLevelEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !isBlockedPathSegment(name)),
    topLevelFiles: topLevelEntries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
    indexedFileCount: indexedFiles.length,
    sampleFiles: indexedFiles.slice(0, 30),
    packageJson: packageJsonText,
    tsconfig: tsconfigText,
    readme: readmeText,
  };
}
