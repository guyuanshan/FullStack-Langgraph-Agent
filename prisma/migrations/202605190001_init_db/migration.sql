-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "summaryUpdatedAt" DATETIME,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "rawJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT,
    "riskLevel" TEXT,
    "permissions" TEXT,
    "argsJson" TEXT,
    "resultSummary" TEXT,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "toolCallId" TEXT,
    "toolName" TEXT NOT NULL,
    "source" TEXT,
    "url" TEXT,
    "riskLevel" TEXT,
    "permissions" TEXT,
    "status" TEXT NOT NULL,
    "argsJson" TEXT,
    "resultSummary" TEXT,
    "detail" TEXT,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "ToolCall" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_sessionId_orderIndex_key" ON "Message"("sessionId", "orderIndex");

-- CreateIndex
CREATE INDEX "ToolCall_sessionId_createdAt_idx" ON "ToolCall"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_sessionId_threadId_key" ON "Checkpoint"("sessionId", "threadId");

-- CreateIndex
CREATE INDEX "AuditLog_sessionId_createdAt_idx" ON "AuditLog"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_toolCallId_createdAt_idx" ON "AuditLog"("toolCallId", "createdAt");
