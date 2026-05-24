export type ProjectMemoryType =
  | "project_structure"
  | "tech_stack"
  | "architecture_decision"
  | "bug_fix"
  | "user_preference"
  | "readme_chunk"
  | "doc_chunk"
  | "code_chunk"
  | "patch_memory";

export type ProjectMemoryRecord = {
  id: string;
  projectId: string;
  type: ProjectMemoryType | string;
  sourcePath: string | null;
  chunkKey: string;
  title: string | null;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown> | null;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MemoryChunk = {
  projectId: string;
  type: ProjectMemoryType;
  sourcePath: string | null;
  chunkKey: string;
  title: string | null;
  content: string;
  metadata?: Record<string, unknown>;
};
