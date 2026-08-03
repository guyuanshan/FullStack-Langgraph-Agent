-- 4.2: add tenantId to core resources with backfill to default-tenant

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Ensure default tenant exists and Tenant has isActive
CREATE TABLE "new_Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Tenant" ("createdAt", "id", "name", "updatedAt", "isActive")
SELECT "createdAt", "id", "name", "updatedAt", true FROM "Tenant";
DROP TABLE "Tenant";
ALTER TABLE "new_Tenant" RENAME TO "Tenant";

INSERT INTO "Tenant" ("id", "name", "isActive", "createdAt", "updatedAt")
SELECT 'default-tenant', 'Default Tenant', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'default-tenant');

-- Session first so children can join for tenantId
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "summaryUpdatedAt" DATETIME,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("createdAt", "id", "lastMessageAt", "messageCount", "summary", "summaryUpdatedAt", "title", "updatedAt", "userId", "tenantId")
SELECT "createdAt", "id", "lastMessageAt", "messageCount", "summary", "summaryUpdatedAt", "title", "updatedAt", "userId", 'default-tenant'
FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_tenantId_createdAt_idx" ON "Session"("tenantId", "createdAt");
CREATE INDEX "Session_tenantId_updatedAt_idx" ON "Session"("tenantId", "updatedAt");
CREATE INDEX "Session_tenantId_userId_updatedAt_idx" ON "Session"("tenantId", "userId", "updatedAt");

CREATE TABLE "new_AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentRun" ("completionReason", "entrypoint", "errorMessage", "finishedAt", "id", "latencyMs", "latestUserTask", "runtimeType", "sessionId", "startedAt", "status", "trigger", "tenantId")
SELECT ar."completionReason", ar."entrypoint", ar."errorMessage", ar."finishedAt", ar."id", ar."latencyMs", ar."latestUserTask", ar."runtimeType", ar."sessionId", ar."startedAt", ar."status", ar."trigger",
  COALESCE(s."tenantId", 'default-tenant')
FROM "AgentRun" ar
LEFT JOIN "Session" s ON s."id" = ar."sessionId";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE INDEX "AgentRun_sessionId_startedAt_idx" ON "AgentRun"("sessionId", "startedAt");
CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");
CREATE INDEX "AgentRun_tenantId_startedAt_idx" ON "AgentRun"("tenantId", "startedAt");
CREATE INDEX "AgentRun_tenantId_sessionId_startedAt_idx" ON "AgentRun"("tenantId", "sessionId", "startedAt");

CREATE TABLE "new_AgentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "AgentStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentStep" ("agentName", "finishedAt", "id", "inputSummary", "latencyMs", "nodeName", "outputSummary", "runId", "sessionId", "startedAt", "status", "stepType", "tenantId")
SELECT st."agentName", st."finishedAt", st."id", st."inputSummary", st."latencyMs", st."nodeName", st."outputSummary", st."runId", st."sessionId", st."startedAt", st."status", st."stepType",
  COALESCE(s."tenantId", r."tenantId", 'default-tenant')
FROM "AgentStep" st
LEFT JOIN "Session" s ON s."id" = st."sessionId"
LEFT JOIN "AgentRun" r ON r."id" = st."runId";
DROP TABLE "AgentStep";
ALTER TABLE "new_AgentStep" RENAME TO "AgentStep";
CREATE INDEX "AgentStep_runId_startedAt_idx" ON "AgentStep"("runId", "startedAt");
CREATE INDEX "AgentStep_sessionId_startedAt_idx" ON "AgentStep"("sessionId", "startedAt");
CREATE INDEX "AgentStep_tenantId_sessionId_startedAt_idx" ON "AgentStep"("tenantId", "sessionId", "startedAt");

CREATE TABLE "new_AgentTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "AgentTrace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentTrace_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentTrace" ("agentName", "createdAt", "detailJson", "id", "latencyMs", "message", "phase", "sessionId", "taskKind", "toolCount", "traceGroupId", "tenantId")
SELECT t."agentName", t."createdAt", t."detailJson", t."id", t."latencyMs", t."message", t."phase", t."sessionId", t."taskKind", t."toolCount", t."traceGroupId",
  COALESCE(s."tenantId", 'default-tenant')
FROM "AgentTrace" t
LEFT JOIN "Session" s ON s."id" = t."sessionId";
DROP TABLE "AgentTrace";
ALTER TABLE "new_AgentTrace" RENAME TO "AgentTrace";
CREATE INDEX "AgentTrace_sessionId_createdAt_idx" ON "AgentTrace"("sessionId", "createdAt");
CREATE INDEX "AgentTrace_traceGroupId_createdAt_idx" ON "AgentTrace"("traceGroupId", "createdAt");
CREATE INDEX "AgentTrace_tenantId_sessionId_createdAt_idx" ON "AgentTrace"("tenantId", "sessionId", "createdAt");

CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "rawJson" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("archived", "content", "createdAt", "id", "orderIndex", "rawJson", "role", "sessionId", "tenantId")
SELECT m."archived", m."content", m."createdAt", m."id", m."orderIndex", m."rawJson", m."role", m."sessionId",
  COALESCE(s."tenantId", 'default-tenant')
FROM "Message" m
LEFT JOIN "Session" s ON s."id" = m."sessionId";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_sessionId_archived_orderIndex_idx" ON "Message"("sessionId", "archived", "orderIndex");
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
CREATE INDEX "Message_tenantId_sessionId_createdAt_idx" ON "Message"("tenantId", "sessionId", "createdAt");
CREATE UNIQUE INDEX "Message_sessionId_orderIndex_key" ON "Message"("sessionId", "orderIndex");

CREATE TABLE "new_Checkpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Checkpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Checkpoint" ("createdAt", "id", "payload", "sessionId", "threadId", "updatedAt", "tenantId")
SELECT c."createdAt", c."id", c."payload", c."sessionId", c."threadId", c."updatedAt",
  COALESCE(s."tenantId", 'default-tenant')
FROM "Checkpoint" c
LEFT JOIN "Session" s ON s."id" = c."sessionId";
DROP TABLE "Checkpoint";
ALTER TABLE "new_Checkpoint" RENAME TO "Checkpoint";
CREATE INDEX "Checkpoint_tenantId_sessionId_createdAt_idx" ON "Checkpoint"("tenantId", "sessionId", "createdAt");
CREATE UNIQUE INDEX "Checkpoint_sessionId_threadId_key" ON "Checkpoint"("sessionId", "threadId");

CREATE TABLE "new_ToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "ToolCall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ToolCall" ("approvedByUser", "argsJson", "createdAt", "errorMessage", "estimatedCostUsd", "finishedAt", "id", "latencyMs", "permissions", "resultJson", "resultSummary", "riskLevel", "runId", "sessionId", "source", "startedAt", "status", "stepId", "toolName", "updatedAt", "tenantId")
SELECT tc."approvedByUser", tc."argsJson", tc."createdAt", tc."errorMessage", tc."estimatedCostUsd", tc."finishedAt", tc."id", tc."latencyMs", tc."permissions", tc."resultJson", tc."resultSummary", tc."riskLevel", tc."runId", tc."sessionId", tc."source", tc."startedAt", tc."status", tc."stepId", tc."toolName", tc."updatedAt",
  COALESCE(s."tenantId", 'default-tenant')
FROM "ToolCall" tc
LEFT JOIN "Session" s ON s."id" = tc."sessionId";
DROP TABLE "ToolCall";
ALTER TABLE "new_ToolCall" RENAME TO "ToolCall";
CREATE INDEX "ToolCall_sessionId_createdAt_idx" ON "ToolCall"("sessionId", "createdAt");
CREATE INDEX "ToolCall_runId_createdAt_idx" ON "ToolCall"("runId", "createdAt");
CREATE INDEX "ToolCall_stepId_createdAt_idx" ON "ToolCall"("stepId", "createdAt");
CREATE INDEX "ToolCall_tenantId_sessionId_createdAt_idx" ON "ToolCall"("tenantId", "sessionId", "createdAt");
CREATE INDEX "ToolCall_tenantId_createdAt_idx" ON "ToolCall"("tenantId", "createdAt");

CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "ToolCall" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditLog" ("argsJson", "createdAt", "detail", "id", "latencyMs", "permissions", "resultSummary", "riskLevel", "sessionId", "source", "status", "toolCallId", "toolName", "url", "tenantId")
SELECT a."argsJson", a."createdAt", a."detail", a."id", a."latencyMs", a."permissions", a."resultSummary", a."riskLevel", a."sessionId", a."source", a."status", a."toolCallId", a."toolName", a."url",
  COALESCE(s."tenantId", 'default-tenant')
FROM "AuditLog" a
LEFT JOIN "Session" s ON s."id" = a."sessionId";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_sessionId_createdAt_idx" ON "AuditLog"("sessionId", "createdAt");
CREATE INDEX "AuditLog_toolCallId_createdAt_idx" ON "AuditLog"("toolCallId", "createdAt");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_tenantId_sessionId_createdAt_idx" ON "AuditLog"("tenantId", "sessionId", "createdAt");

CREATE TABLE "new_InterruptEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "InterruptEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InterruptEvent" ("createdAt", "id", "kind", "message", "payloadJson", "reason", "runId", "sessionId", "status", "stepId", "updatedAt", "tenantId")
SELECT i."createdAt", i."id", i."kind", i."message", i."payloadJson", i."reason", i."runId", i."sessionId", i."status", i."stepId", i."updatedAt",
  COALESCE(s."tenantId", r."tenantId", 'default-tenant')
FROM "InterruptEvent" i
LEFT JOIN "Session" s ON s."id" = i."sessionId"
LEFT JOIN "AgentRun" r ON r."id" = i."runId";
DROP TABLE "InterruptEvent";
ALTER TABLE "new_InterruptEvent" RENAME TO "InterruptEvent";
CREATE INDEX "InterruptEvent_runId_createdAt_idx" ON "InterruptEvent"("runId", "createdAt");
CREATE INDEX "InterruptEvent_sessionId_createdAt_idx" ON "InterruptEvent"("sessionId", "createdAt");
CREATE INDEX "InterruptEvent_tenantId_sessionId_createdAt_idx" ON "InterruptEvent"("tenantId", "sessionId", "createdAt");

CREATE TABLE "new_ErrorLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT,
    "stepId" TEXT,
    "sessionId" TEXT,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "contextJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ErrorLog" ("contextJson", "createdAt", "id", "message", "runId", "sessionId", "source", "stack", "stepId", "tenantId")
SELECT e."contextJson", e."createdAt", e."id", e."message", e."runId", e."sessionId", e."source", e."stack", e."stepId",
  COALESCE(s."tenantId", r."tenantId", 'default-tenant')
FROM "ErrorLog" e
LEFT JOIN "Session" s ON s."id" = e."sessionId"
LEFT JOIN "AgentRun" r ON r."id" = e."runId";
DROP TABLE "ErrorLog";
ALTER TABLE "new_ErrorLog" RENAME TO "ErrorLog";
CREATE INDEX "ErrorLog_runId_createdAt_idx" ON "ErrorLog"("runId", "createdAt");
CREATE INDEX "ErrorLog_sessionId_createdAt_idx" ON "ErrorLog"("sessionId", "createdAt");
CREATE INDEX "ErrorLog_tenantId_createdAt_idx" ON "ErrorLog"("tenantId", "createdAt");

CREATE TABLE "new_ModelCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    CONSTRAINT "ModelCall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ModelCall" ("agentName", "completionTokens", "createdAt", "errorMessage", "estimatedCostUsd", "finishedAt", "id", "inputSummary", "latencyMs", "model", "nodeName", "outputSummary", "promptTokens", "provider", "reasoningTokens", "runId", "sessionId", "status", "stepId", "tenantId")
SELECT mc."agentName", mc."completionTokens", mc."createdAt", mc."errorMessage", mc."estimatedCostUsd", mc."finishedAt", mc."id", mc."inputSummary", mc."latencyMs", mc."model", mc."nodeName", mc."outputSummary", mc."promptTokens", mc."provider", mc."reasoningTokens", mc."runId", mc."sessionId", mc."status", mc."stepId",
  COALESCE(s."tenantId", r."tenantId", 'default-tenant')
FROM "ModelCall" mc
LEFT JOIN "Session" s ON s."id" = mc."sessionId"
LEFT JOIN "AgentRun" r ON r."id" = mc."runId";
DROP TABLE "ModelCall";
ALTER TABLE "new_ModelCall" RENAME TO "ModelCall";
CREATE INDEX "ModelCall_runId_createdAt_idx" ON "ModelCall"("runId", "createdAt");
CREATE INDEX "ModelCall_sessionId_createdAt_idx" ON "ModelCall"("sessionId", "createdAt");
CREATE INDEX "ModelCall_tenantId_sessionId_createdAt_idx" ON "ModelCall"("tenantId", "sessionId", "createdAt");

CREATE TABLE "new_ProjectMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProjectMemory" ("chunkKey", "content", "contentHash", "createdAt", "embedding", "id", "metadataJson", "projectId", "sourcePath", "title", "type", "updatedAt", "tenantId")
SELECT "chunkKey", "content", "contentHash", "createdAt", "embedding", "id", "metadataJson", "projectId", "sourcePath", "title", "type", "updatedAt", 'default-tenant'
FROM "ProjectMemory";
DROP TABLE "ProjectMemory";
ALTER TABLE "new_ProjectMemory" RENAME TO "ProjectMemory";
CREATE INDEX "ProjectMemory_tenantId_projectId_type_updatedAt_idx" ON "ProjectMemory"("tenantId", "projectId", "type", "updatedAt");
CREATE INDEX "ProjectMemory_tenantId_projectId_sourcePath_idx" ON "ProjectMemory"("tenantId", "projectId", "sourcePath");
CREATE INDEX "ProjectMemory_tenantId_createdAt_idx" ON "ProjectMemory"("tenantId", "createdAt");
CREATE UNIQUE INDEX "ProjectMemory_tenantId_projectId_chunkKey_key" ON "ProjectMemory"("tenantId", "projectId", "chunkKey");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
