-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "runtimeType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entrypoint" TEXT,
    "latestUserTask" TEXT,
    "completionReason" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "latencyMs" INTEGER,
    CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT,
    "agentName" TEXT,
    "nodeName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stepType" TEXT NOT NULL,
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "latencyMs" INTEGER,
    CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterruptEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "sessionId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "payloadJson" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterruptEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "stepId" TEXT,
    "sessionId" TEXT,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "contextJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentRun_sessionId_startedAt_idx" ON "AgentRun"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AgentStep_runId_startedAt_idx" ON "AgentStep"("runId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentStep_sessionId_startedAt_idx" ON "AgentStep"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "InterruptEvent_runId_createdAt_idx" ON "InterruptEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "InterruptEvent_sessionId_createdAt_idx" ON "InterruptEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_runId_createdAt_idx" ON "ErrorLog"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_sessionId_createdAt_idx" ON "ErrorLog"("sessionId", "createdAt");
