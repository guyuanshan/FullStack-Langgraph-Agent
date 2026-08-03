import { resolveWriteTenantId } from "../db/tenant";
import { createEmbedding, cosineSimilarity, resolveEmbeddingProvider } from "./embedding";
import { getProjectId } from "./project";
import { listProjectMemories } from "./store";
import type { ProjectMemoryType } from "./types";

type RetrievedMemory = {
  id: string;
  type: string;
  sourcePath: string | null;
  title: string | null;
  content: string;
  score: number;
  metadata: Record<string, unknown> | null;
};

function tokenize(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_\u4e00-\u9fa5./-]+/g) ?? [])];
}

function lexicalScore(query: string, candidate: string) {
  const queryTokens = tokenize(query);
  const candidateLower = candidate.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (!token) {
      continue;
    }

    if (candidateLower.includes(token)) {
      score += token.length >= 8 ? 0.08 : 0.04;
    }
  }

  return score;
}

function scoreTypeBoost(type: string, query: string) {
  const lowerQuery = query.toLowerCase();

  if (type === "tech_stack" && /(技术栈|stack|framework|used|依赖)/i.test(lowerQuery)) {
    return 1.25;
  }

  if (
    (type === "project_structure" || type === "doc_chunk") &&
    /(结构|目录|architecture|架构|readme|文档)/i.test(lowerQuery)
  ) {
    return 0.12;
  }

  if (type === "code_chunk" && /(tool|component|route|weather|ToolCallCard|代码)/i.test(lowerQuery)) {
    return 0.08;
  }

  if (type === "bug_fix" && /(bug|修复|之前修过|问题)/i.test(lowerQuery)) {
    return 0.18;
  }

  return 0;
}

export async function retrieveProjectMemories(options: {
  query: string;
  topK?: number;
  projectId?: string;
  tenantId?: string;
  sessionId?: string | null;
  types?: ProjectMemoryType[];
  embeddingProvider?: string;
}) {
  const query = options.query.trim();
  if (!options.tenantId && !options.sessionId) {
    throw new Error(
      "tenantId or sessionId is required to retrieve project memories"
    );
  }

  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId: options.sessionId,
  });

  if (!query) {
    return {
      projectId: options.projectId ?? getProjectId(),
      query,
      embeddingProvider: resolveEmbeddingProvider(options.embeddingProvider),
      results: [] as RetrievedMemory[],
    };
  }

  const projectId = options.projectId ?? getProjectId();
  const provider = resolveEmbeddingProvider(options.embeddingProvider);
  const queryEmbedding = await createEmbedding(query, provider);
  const rows = await listProjectMemories(projectId, {
    tenantId,
  });
  const filteredRows = options.types?.length
    ? rows.filter((row) => options.types?.includes(row.type as ProjectMemoryType))
    : rows;
  const topK = Math.min(Math.max(options.topK ?? 6, 1), 20);

  const results = filteredRows
    .map((row) => ({
      id: row.id,
      type: row.type,
      sourcePath: row.sourcePath,
      title: row.title,
      content: row.content,
      score:
        cosineSimilarity(queryEmbedding.values, row.embedding) +
        scoreTypeBoost(row.type, query) +
        lexicalScore(query, row.title ?? "") +
        lexicalScore(query, row.sourcePath ?? "") +
        lexicalScore(query, row.content.slice(0, 500)),
      metadata: row.metadata,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  return {
    projectId,
    query,
    embeddingProvider: provider,
    results,
  };
}

export function renderRetrievedMemories(results: RetrievedMemory[]) {
  if (results.length === 0) {
    return null;
  }

  return results
    .map((result, index) => {
      const header = [
        `[Memory ${index + 1}]`,
        `type=${result.type}`,
        result.sourcePath ? `path=${result.sourcePath}` : null,
        result.title ? `title=${result.title}` : null,
        `score=${result.score.toFixed(3)}`,
      ]
        .filter(Boolean)
        .join(" ");

      return `${header}\n${result.content}`;
    })
    .join("\n\n");
}
