import { readFile } from "node:fs/promises";
import { validateWorkspacePath } from "./workspace";

const DEFAULT_MAX_CHARS_PER_FILE = 4000;

function compactContent(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return {
      content,
      truncated: false,
    };
  }

  const headLength = Math.floor(maxChars * 0.65);
  const tailLength = maxChars - headLength;
  const head = content.slice(0, headLength);
  const tail = content.slice(-tailLength);

  return {
    content: `${head}\n...<truncated ${content.length - maxChars} chars>...\n${tail}`,
    truncated: true,
  };
}

export async function readProjectFiles(options: {
  paths: string[];
  maxCharsPerFile?: number;
}) {
  const maxCharsPerFile = Math.min(
    Math.max(options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE, 500),
    12000
  );

  if (!Array.isArray(options.paths) || options.paths.length === 0) {
    throw new Error("At least one path is required");
  }

  const files = await Promise.all(
    options.paths.map(async (filePath) => {
      if (typeof filePath !== "string") {
        throw new Error("File paths must be strings");
      }

      const validated = validateWorkspacePath(filePath);
      const original = await readFile(validated.absolutePath, "utf8");
      const compact = compactContent(original, maxCharsPerFile);

      return {
        path: validated.relativePath,
        content: compact.content,
        truncated: compact.truncated,
        originalLength: original.length,
      };
    })
  );

  return {
    kind: "project_file_context",
    maxCharsPerFile,
    files,
  };
}
