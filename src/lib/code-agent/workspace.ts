import path from "node:path";

export const WORKSPACE_ROOT = process.cwd(); 
//  WORKSPACE_ROOT 常量定义了工作空间的根目录，
// 使用 Node.js 的 process.cwd() 方法获取当前工作目录的绝对路径。
// 这意味着所有的文件操作和路径验证都将基于这个根目录进行，
// 确保工具只能访问和操作工作空间内的文件，从而增强安全性和隔离性。

const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".demo-output",
  "dist",
  "build",
  "coverage",
]);


const BLOCKED_FILENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
]);

function normalizePathInput(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Path cannot be empty");
  }

  if (trimmed.includes("\0")) {
    throw new Error("Path contains invalid characters");
  }

  return trimmed.replace(/\\/g, "/");
}

export function isBlockedPathSegment(segment: string) {
  return BLOCKED_SEGMENTS.has(segment);
}

export function validateWorkspacePath(input: string) {
  // validateWorkspacePath 函数用于验证和规范化用户输入的路径，
  // 确保它在工作空间内，并且不包含任何被阻止的路径段或文件名。
  // 函数首先规范化输入路径，解析出绝对路径和相对于工作空间根目录的路径，
  // 然后检查路径是否在工作空间内，并且不包含任何被阻止的路径段或文件名。
  // 如果验证通过，函数返回绝对路径和相对路径；
  // 如果验证失败，则抛出相应的错误。
  const normalized = normalizePathInput(input);
  const resolved = path.resolve(WORKSPACE_ROOT, normalized);
  const relativePath = path.relative(WORKSPACE_ROOT, resolved);


  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    if (relativePath === "") {
      return {
        absolutePath: resolved,
        relativePath: ".",
      };
    }

    throw new Error(`Path is outside the workspace: ${input}`);
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  // segments 变量是一个数组，包含了相对路径的各个部分（路径段）。通过 path.sep 分割相对路径，并过滤掉空字符串，得到一个干净的路径段数组。
  const filename = segments.at(-1) ?? "";
  // filename 变量获取路径的最后一个部分，即文件名。如果路径是一个目录，filename 将是目录的最后一个部分。通过 segments.at(-1) 获取最后一个元素，如果 segments 为空，则使用空字符串作为默认值。

  if (segments.some(isBlockedPathSegment) || BLOCKED_FILENAMES.has(filename)) {
    throw new Error(`Access is blocked for path: ${input}`);
  }


  return {
    absolutePath: resolved,
    relativePath: relativePath.replace(/\\/g, "/"),
  };
}

export function toDisplayPath(input: string) {

  return validateWorkspacePath(input).relativePath;
}

export function isTextLikeFile(filePath: string) {
  const lower = filePath.toLowerCase();

  return /\.(tsx?|jsx?|mjs|cjs|json|md|css|scss|html|yml|yaml|txt|env|sh)$/.test(
    lower
  );
}
