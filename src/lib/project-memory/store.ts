import { createHash } from "node:crypto";
import { prisma } from "../db/client";
import { createEmbedding } from "./embedding";
import type {
  MemoryChunk,
  ProjectMemoryRecord,
  ProjectMemoryType,
} from "./types";

function serializeEmbedding(values: number[]) {
  return JSON.stringify(values);
}

function parseEmbedding(value: string) {
  return JSON.parse(value) as number[];
}

function hashContent(content: string) {
  return createHash("sha1").update(content).digest("hex");
}

type SyncProjectMemoryOptions = {
  embeddingProvider?: string;
  concurrency?: number;
  onProgress?: (event: {
    phase: "embedding";
    completed: number;
    total: number;
    chunkKey: string;
    sourcePath: string | null;
  }) => void;
};

function resolveConcurrency(options?: SyncProjectMemoryOptions) {
  if (typeof options?.concurrency === "number" && options.concurrency > 0) {
    return Math.max(1, Math.floor(options.concurrency));
  }

  if (options?.embeddingProvider === "gemini") {
    return 4;
  }

  if (options?.embeddingProvider === "openai") {
    return 6;
  }

  return 16;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const current = items[cursor];
      const currentIndex = cursor;
      cursor += 1;
      await worker(current, currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => runWorker()
  );

  await Promise.all(workers);
}

async function loadExistingProjectMemory(projectId: string, sourcePaths?: string[]) {
  const rows = await prisma.projectMemory.findMany({
    where: {
      projectId,
      ...(sourcePaths?.length
        ? {
            sourcePath: {
              in: sourcePaths,
            },
          }
        : {}),
    },
    select: {
      id: true,
      chunkKey: true,
      sourcePath: true,
      contentHash: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.chunkKey,
      {
        id: row.id,
        sourcePath: row.sourcePath,
        contentHash: row.contentHash,
      },
    ])
  );
}

export async function upsertProjectMemoryChunk(
  chunk: MemoryChunk,
  options?: SyncProjectMemoryOptions
) {
  const embedding = await createEmbedding(chunk.content, options?.embeddingProvider);
  const contentHash = hashContent(chunk.content);

  return prisma.projectMemory.upsert({
    where: {
      projectId_chunkKey: {
        projectId: chunk.projectId,
        chunkKey: chunk.chunkKey,
      },
    },
    update: {
      type: chunk.type,
      sourcePath: chunk.sourcePath,
      title: chunk.title,
      content: chunk.content,
      embedding: serializeEmbedding(embedding.values),
      metadataJson: chunk.metadata ? JSON.stringify(chunk.metadata) : null,
      contentHash,
    },
    create: {
      projectId: chunk.projectId,
      type: chunk.type,
      sourcePath: chunk.sourcePath,
      chunkKey: chunk.chunkKey,
      title: chunk.title,
      content: chunk.content,
      embedding: serializeEmbedding(embedding.values),
      metadataJson: chunk.metadata ? JSON.stringify(chunk.metadata) : null,
      contentHash,
    },
  });
}

export async function replaceProjectMemory(
  projectId: string,
  chunks: MemoryChunk[],
  options?: SyncProjectMemoryOptions
) {
  const incomingChunkKeys = new Set(chunks.map((chunk) => chunk.chunkKey));
  const existingMap = await loadExistingProjectMemory(projectId);

  await prisma.projectMemory.deleteMany({
    where: {
      projectId,
      chunkKey: {
        notIn: [...incomingChunkKeys],
      },
    },
  });

  const nextChunks = chunks
    .map((chunk) => ({
      chunk,
      contentHash: hashContent(chunk.content),
      existing: existingMap.get(chunk.chunkKey),
    }))
    .filter(({ contentHash, existing }) => existing?.contentHash !== contentHash);
  let completedCount = 0;

  await runWithConcurrency(
    nextChunks,
    resolveConcurrency(options),
    async ({ chunk }) => {
      await upsertProjectMemoryChunk(chunk, options);
      completedCount += 1;
      options?.onProgress?.({
        phase: "embedding",
        completed: completedCount,
        total: nextChunks.length,
        chunkKey: chunk.chunkKey,
        sourcePath: chunk.sourcePath,
      });
    }
  );

  return {
    projectId,
    memoryCount: chunks.length,
    updatedCount: nextChunks.length,
    skippedCount: chunks.length - nextChunks.length,
  };
}

export async function refreshProjectMemoryPaths(
  projectId: string,
  chunks: MemoryChunk[],
  sourcePaths: string[],
  options?: SyncProjectMemoryOptions
) {
  const existingMap = await loadExistingProjectMemory(projectId, sourcePaths);
  const incomingChunkKeys = new Set(chunks.map((chunk) => chunk.chunkKey));

  await prisma.projectMemory.deleteMany({
    where: {
      projectId,
      AND: [
        {
          sourcePath: {
            in: sourcePaths,
          },
        },
        {
          chunkKey: {
            notIn: [...incomingChunkKeys],
          },
        },
      ],
    },
  });

  const nextChunks = chunks
    .map((chunk) => ({
      chunk,
      contentHash: hashContent(chunk.content),
      existing: existingMap.get(chunk.chunkKey),
    }))
    .filter(({ contentHash, existing }) => existing?.contentHash !== contentHash);
  let completedCount = 0;

  await runWithConcurrency(
    nextChunks,
    resolveConcurrency(options),
    async ({ chunk }) => {
      await upsertProjectMemoryChunk(chunk, options);
      completedCount += 1;
      options?.onProgress?.({
        phase: "embedding",
        completed: completedCount,
        total: nextChunks.length,
        chunkKey: chunk.chunkKey,
        sourcePath: chunk.sourcePath,
      });
    }
  );

  return {
    projectId,
    refreshedPaths: sourcePaths,
    memoryCount: chunks.length,
    updatedCount: nextChunks.length,
    skippedCount: chunks.length - nextChunks.length,
  };
}

export async function addProjectMemoryNote(options: {
  projectId: string;
  type: ProjectMemoryType;
  chunkKey: string;
  title?: string;
  content: string;
  sourcePath?: string | null;
  metadata?: Record<string, unknown>;
  embeddingProvider?: string;
}) {
  return upsertProjectMemoryChunk(
    {
      projectId: options.projectId,
      type: options.type,
      sourcePath: options.sourcePath ?? null,
      chunkKey: options.chunkKey,
      title: options.title ?? null,
      content: options.content,
      metadata: options.metadata,
    },
    {
      embeddingProvider: options.embeddingProvider,
    }
  );
}

export async function listProjectMemories(projectId: string) {
  const rows = await prisma.projectMemory.findMany({
    where: {
      projectId,
    },
    orderBy: [
      {
        type: "asc",
      },
      {
        updatedAt: "desc",
      },
    ],
  });

  return rows.map(
    (row): ProjectMemoryRecord => ({
      ...row,
      embedding: parseEmbedding(row.embedding),
      metadata: row.metadataJson
        ? (JSON.parse(row.metadataJson) as Record<string, unknown>)
        : null,
    })
  );
}
