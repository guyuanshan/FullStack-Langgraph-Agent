import { mkdir, writeFile } from "node:fs/promises"; // 使用 Node.js 的 fs/promises 模块来处理文件系统操作
import path from "node:path"; // 使用 Node.js 的 path 模块来处理文件路径
import type { ToolDefinition } from "./types"; // 导入工具定义的类型

const OUTPUT_DIR = path.join(process.cwd(), ".demo-output"); // 定义输出目录为当前工作目录下的 .demo-output 文件夹

function sanitizeFilename(filename: string) { // 创建一个函数来清理和验证文件名，确保它只包含允许的字符
  const trimmed = filename.trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error(
      "Tool write_demo_file requires a filename containing only letters, numbers, dot, underscore, or dash"
    );
  }

  return trimmed;
}

export const writeDemoFileTool: ToolDefinition = { // 定义一个工具对象，包含工具的名称、描述、参数规范和执行逻辑
  name: "write_demo_file",
  description:
    "Write a demo text file into the local .demo-output directory. Use this when the user asks you to create or save a local note or file.",
  source: "local",
  riskLevel: "confirm_required",
  permissions: ["write"],
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "File name to create inside .demo-output, for example note.txt",
      },
      content: {
        type: "string",
        description: "Text content to write into the file",
      },
    },
    required: ["filename", "content"],
  },
  async execute(args) { // 定义工具的执行函数，接收参数并执行相应的文件写入操作
    const filename = args.filename;
    const content = args.content;

    if (typeof filename !== "string") { 
      throw new Error("Tool write_demo_file requires a string filename");
    }

    if (typeof content !== "string") {
      throw new Error("Tool write_demo_file requires a string content");
    }

    const safeFilename = sanitizeFilename(filename); // 使用之前定义的 sanitizeFilename 函数来清理和验证文件名
    const targetPath = path.join(OUTPUT_DIR, safeFilename); // 构建目标文件的完整路径

    await mkdir(OUTPUT_DIR, { recursive: true }); // 确保输出目录存在，如果不存在则创建它
    await writeFile(targetPath, content, "utf8"); // 将内容写入目标文件，使用 UTF-8 编码

    return { // 返回一个对象，包含文件的路径、字节大小和文件名等信息
      path: targetPath,
      bytes: Buffer.byteLength(content, "utf8"),
      filename: safeFilename,
    };
  },
};
