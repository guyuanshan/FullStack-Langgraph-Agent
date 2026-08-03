import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ErrorCodes,
  createFileSandboxContext,
  deleteFile,
  getFileSandboxErrorCode,
  listDirectory,
  readText,
  resolveForRead,
  resolveLogicalPath,
  searchFiles,
  writeText,
} from "./index";

const tempDirs: string[] = [];

async function createSandboxFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "file-sandbox-"));
  tempDirs.push(root);

  const workspace = path.join(root, "sandbox");
  const outside = path.join(root, "outside");
  await mkdir(workspace, { recursive: true });
  await mkdir(path.join(workspace, "nested"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(path.join(workspace, "allowed.txt"), "hello-allowed", "utf8");
  await writeFile(path.join(workspace, ".env"), "SECRET=1", "utf8");
  await writeFile(path.join(workspace, ".env.example"), "EXAMPLE=1", "utf8");
  await writeFile(path.join(outside, "private-data.txt"), "outside-private", "utf8");

  await symlink(outside, path.join(workspace, "link-outside"));
  await symlink(outside, path.join(workspace, "nested", "link-outside"));

  const context = await createFileSandboxContext({
    tenantId: "tenant-a",
    runId: "run-1",
    workspaceRoot: workspace,
    access: "read",
  });

  return { root, workspace, outside, context };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(getFileSandboxErrorCode(error), code);
    if (error instanceof Error) {
      assert.equal(error.message.includes(tmpdir()), false);
      assert.equal(error.message.includes("outside-private"), false);
    }
    return true;
  });
}

describe("FileSandbox path policy", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it("allows normal relative reads", async () => {
    const { context } = await createSandboxFixture();
    const result = await readText(context, "allowed.txt");
    assert.equal(result.content, "hello-allowed");
    assert.equal(result.path, "allowed.txt");
  });

  it("rejects traversal and absolute paths with stable codes", async () => {
    const { context } = await createSandboxFixture();

    const rejected = [
      ["../secret", ErrorCodes.PATH_OUTSIDE_WORKSPACE],
      ["../../.env", ErrorCodes.PATH_OUTSIDE_WORKSPACE],
      ["/etc/passwd", ErrorCodes.PATH_ABSOLUTE],
      ["C:\\Windows\\System32\\drivers\\etc\\hosts", ErrorCodes.PATH_ABSOLUTE],
      ["foo\\..\\..\\secret", ErrorCodes.PATH_OUTSIDE_WORKSPACE],
      ["path-with-NUL\0.txt", ErrorCodes.PATH_INVALID],
      ["", ErrorCodes.PATH_EMPTY],
    ] as const;

    for (const [input, code] of rejected) {
      assert.throws(
        () =>
          resolveLogicalPath(context, input, {
            allowRoot: false,
            access: "read",
          }),
        (error: unknown) => getFileSandboxErrorCode(error) === code
      );
    }
  });

  it("rejects sensitive paths after normalization", async () => {
    const { context } = await createSandboxFixture();

    for (const input of [".env", "./.env", "foo/../.env", "nested/../.env"]) {
      assert.throws(
        () =>
          resolveLogicalPath(context, input, {
            allowRoot: false,
            access: "read",
          }),
        (error: unknown) =>
          getFileSandboxErrorCode(error) === ErrorCodes.SENSITIVE_PATH
      );
    }

    const example = resolveLogicalPath(context, ".env.example", {
      allowRoot: false,
      access: "read",
    });
    assert.equal(example.relativePath, ".env.example");

    assert.throws(
      () =>
        resolveLogicalPath(context, ".env.example", {
          allowRoot: false,
          access: "write",
        }),
      (error: unknown) => getFileSandboxErrorCode(error) === ErrorCodes.SENSITIVE_PATH
    );
  });

  it("blocks symlink escape on read/write/delete", async () => {
    const { context } = await createSandboxFixture();

    await expectCode(
      resolveForRead(context, "link-outside/private-data.txt"),
      ErrorCodes.SYMLINK_DENIED
    );
    await expectCode(
      resolveForRead(context, "nested/link-outside/private-data.txt"),
      ErrorCodes.SYMLINK_DENIED
    );
    await expectCode(
      writeText(context, "link-outside/private-data.txt", "x"),
      ErrorCodes.SYMLINK_DENIED
    );
    await expectCode(
      deleteFile(context, "link-outside/private-data.txt"),
      ErrorCodes.SYMLINK_DENIED
    );
  });

  it("writes and deletes only through sandbox policy", async () => {
    const { context } = await createSandboxFixture();
    const writeContext = { ...context, access: "write" as const };

    await writeText(writeContext, "nested/note.md", "# hi");
    const readBack = await readText(context, "nested/note.md");
    assert.equal(readBack.content, "# hi");

    await expectCode(
      writeText(writeContext, "nested/binary.bin", "nope"),
      ErrorCodes.SENSITIVE_PATH
    );

    const deleteContext = { ...context, access: "delete" as const };
    const deleted = await deleteFile(deleteContext, "nested/note.md");
    assert.equal(deleted.deleted, true);
  });

  it("lists and searches without entering blocked/sensitive paths", async () => {
    const { context, workspace } = await createSandboxFixture();
    await mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      path.join(workspace, "node_modules", "pkg", "index.js"),
      "secret-module",
      "utf8"
    );
    await writeFile(path.join(workspace, "visible.md"), "find-me-visible", "utf8");

    const listed = await listDirectory(context, ".");
    assert.equal(
      listed.entries.some((entry) => entry.name === "node_modules"),
      false
    );
    assert.equal(
      listed.entries.some((entry) => entry.name === ".env"),
      false
    );
    assert.equal(
      listed.entries.some((entry) => entry.name === "allowed.txt"),
      true
    );

    const searched = await searchFiles(context, { query: "find-me-visible" });
    assert.deepEqual(searched.matches, ["visible.md"]);

    const sensitiveSearch = await searchFiles(context, { query: "SECRET=1" });
    assert.equal(sensitiveSearch.matches.includes(".env"), false);
  });
});
