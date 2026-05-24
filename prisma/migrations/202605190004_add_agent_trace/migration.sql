CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "traceGroupId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "taskKind" TEXT,
    "message" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "toolCount" INTEGER,
    "detailJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTrace_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AgentTrace_sessionId_createdAt_idx" ON "AgentTrace"("sessionId", "createdAt");
CREATE INDEX "AgentTrace_traceGroupId_createdAt_idx" ON "AgentTrace"("traceGroupId", "createdAt");
