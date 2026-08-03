import {
  buildProjectMemoryChunks,
  buildProjectMemoryChunksForPaths,
} from "./chunking";
import { resolveEmbeddingProvider } from "./embedding";
import { refreshProjectMemoryPaths, replaceProjectMemory } from "./store";

export async function indexProjectMemory(options?: {
  tenantId?: string;
  sessionId?: string | null;
  embeddingProvider?: string;
  onProgress?: (event: {
    phase: "scanning" | "embedding";
    completed: number;
    total: number;
    chunkKey?: string;
    sourcePath?: string | null;
  }) => void;
}) {
  const { projectId, chunks, indexedFiles } = await buildProjectMemoryChunks();
  const provider = resolveEmbeddingProvider(options?.embeddingProvider);
  options?.onProgress?.({
    phase: "scanning",
    completed: chunks.length,
    total: chunks.length,
  });
  const result = await replaceProjectMemory(projectId, chunks, {
    tenantId: options?.tenantId,
    sessionId: options?.sessionId,
    embeddingProvider: provider,
    onProgress: options?.onProgress,
  });

  return {
    ...result,
    indexedFiles,
    embeddingProvider: provider,
  };
}

export async function refreshProjectMemory(options: {
  paths: string[];
  tenantId?: string;
  sessionId?: string | null;
  embeddingProvider?: string;
  onProgress?: (event: {
    phase: "scanning" | "embedding";
    completed: number;
    total: number;
    chunkKey?: string;
    sourcePath?: string | null;
  }) => void;
}) {
  const provider = resolveEmbeddingProvider(options.embeddingProvider);
  const uniquePaths = [...new Set(options.paths.map((path) => path.trim()).filter(Boolean))];
  const { projectId, chunks } = await buildProjectMemoryChunksForPaths(uniquePaths);
  options.onProgress?.({
    phase: "scanning",
    completed: chunks.length,
    total: chunks.length,
  });
  const result = await refreshProjectMemoryPaths(projectId, chunks, uniquePaths, {
    tenantId: options.tenantId,
    sessionId: options.sessionId,
    embeddingProvider: provider,
    onProgress: options.onProgress,
  });

  return {
    ...result,
    embeddingProvider: provider,
  };
}
