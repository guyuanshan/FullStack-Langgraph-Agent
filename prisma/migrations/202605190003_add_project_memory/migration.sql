CREATE TABLE "ProjectMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourcePath" TEXT,
    "chunkKey" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "metadataJson" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ProjectMemory_projectId_chunkKey_key"
ON "ProjectMemory"("projectId", "chunkKey");

CREATE INDEX "ProjectMemory_projectId_type_updatedAt_idx"
ON "ProjectMemory"("projectId", "type", "updatedAt");

CREATE INDEX "ProjectMemory_projectId_sourcePath_idx"
ON "ProjectMemory"("projectId", "sourcePath");
