-- CreateTable
CREATE TABLE "ModelCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "sessionId" TEXT,
    "agentName" TEXT,
    "nodeName" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "estimatedCostUsd" REAL,
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ModelCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT,
    "stepId" TEXT,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT,
    "riskLevel" TEXT,
    "permissions" TEXT,
    "approvedByUser" BOOLEAN,
    "argsJson" TEXT,
    "resultSummary" TEXT,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "estimatedCostUsd" REAL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ToolCall" ("argsJson", "createdAt", "errorMessage", "finishedAt", "id", "latencyMs", "permissions", "resultJson", "resultSummary", "riskLevel", "sessionId", "source", "startedAt", "status", "toolName", "updatedAt") SELECT "argsJson", "createdAt", "errorMessage", "finishedAt", "id", "latencyMs", "permissions", "resultJson", "resultSummary", "riskLevel", "sessionId", "source", "startedAt", "status", "toolName", "updatedAt" FROM "ToolCall";
DROP TABLE "ToolCall";
ALTER TABLE "new_ToolCall" RENAME TO "ToolCall";
CREATE INDEX "ToolCall_sessionId_createdAt_idx" ON "ToolCall"("sessionId", "createdAt");
CREATE INDEX "ToolCall_runId_createdAt_idx" ON "ToolCall"("runId", "createdAt");
CREATE INDEX "ToolCall_stepId_createdAt_idx" ON "ToolCall"("stepId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ModelCall_runId_createdAt_idx" ON "ModelCall"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_sessionId_createdAt_idx" ON "ModelCall"("sessionId", "createdAt");
