import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const stubPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "empty-module.cjs"
);

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(
  request,
  parent,
  isMain,
  options
) {
  if (request === "server-only") {
    return stubPath;
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Ensure the stub exists for CommonJS require paths as well.
require(stubPath);
