-- Enforce composite (tenantId, parentId) FKs for required relations
-- and trigger-based tenant checks for optional parent links.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Parent uniqueness required by composite FKs
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tenantId_id_key" ON "Session"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRun_tenantId_id_key" ON "AgentRun"("tenantId", "id");

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "AgentStep_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentStep" ("agentName", "finishedAt", "id", "inputSummary", "latencyMs", "nodeName", "outputSummary", "runId", "sessionId", "startedAt", "status", "stepType", "tenantId") SELECT "agentName", "finishedAt", "id", "inputSummary", "latencyMs", "nodeName", "outputSummary", "runId", "sessionId", "startedAt", "status", "stepType", "tenantId" FROM "AgentStep";
DROP TABLE "AgentStep";
ALTER TABLE "new_AgentStep" RENAME TO "AgentStep";
CREATE INDEX "AgentStep_runId_startedAt_idx" ON "AgentStep"("runId", "startedAt");
CREATE INDEX "AgentStep_sessionId_startedAt_idx" ON "AgentStep"("sessionId", "startedAt");
CREATE INDEX "AgentStep_tenantId_sessionId_startedAt_idx" ON "AgentStep"("tenantId", "sessionId", "startedAt");
CREATE UNIQUE INDEX "AgentStep_tenantId_id_key" ON "AgentStep"("tenantId", "id");
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
    CONSTRAINT "AgentTrace_tenantId_sessionId_fkey" FOREIGN KEY ("tenantId", "sessionId") REFERENCES "Session" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentTrace" ("agentName", "createdAt", "detailJson", "id", "latencyMs", "message", "phase", "sessionId", "taskKind", "tenantId", "toolCount", "traceGroupId") SELECT "agentName", "createdAt", "detailJson", "id", "latencyMs", "message", "phase", "sessionId", "taskKind", "tenantId", "toolCount", "traceGroupId" FROM "AgentTrace";
DROP TABLE "AgentTrace";
ALTER TABLE "new_AgentTrace" RENAME TO "AgentTrace";
CREATE INDEX "AgentTrace_sessionId_createdAt_idx" ON "AgentTrace"("sessionId", "createdAt");
CREATE INDEX "AgentTrace_traceGroupId_createdAt_idx" ON "AgentTrace"("traceGroupId", "createdAt");
CREATE INDEX "AgentTrace_tenantId_sessionId_createdAt_idx" ON "AgentTrace"("tenantId", "sessionId", "createdAt");
CREATE TABLE "new_Checkpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Checkpoint_tenantId_sessionId_fkey" FOREIGN KEY ("tenantId", "sessionId") REFERENCES "Session" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Checkpoint" ("createdAt", "id", "payload", "sessionId", "tenantId", "threadId", "updatedAt") SELECT "createdAt", "id", "payload", "sessionId", "tenantId", "threadId", "updatedAt" FROM "Checkpoint";
DROP TABLE "Checkpoint";
ALTER TABLE "new_Checkpoint" RENAME TO "Checkpoint";
CREATE INDEX "Checkpoint_tenantId_sessionId_createdAt_idx" ON "Checkpoint"("tenantId", "sessionId", "createdAt");
CREATE UNIQUE INDEX "Checkpoint_sessionId_threadId_key" ON "Checkpoint"("sessionId", "threadId");
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
    CONSTRAINT "InterruptEvent_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InterruptEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InterruptEvent" ("createdAt", "id", "kind", "message", "payloadJson", "reason", "runId", "sessionId", "status", "stepId", "tenantId", "updatedAt") SELECT "createdAt", "id", "kind", "message", "payloadJson", "reason", "runId", "sessionId", "status", "stepId", "tenantId", "updatedAt" FROM "InterruptEvent";
DROP TABLE "InterruptEvent";
ALTER TABLE "new_InterruptEvent" RENAME TO "InterruptEvent";
CREATE INDEX "InterruptEvent_runId_createdAt_idx" ON "InterruptEvent"("runId", "createdAt");
CREATE INDEX "InterruptEvent_sessionId_createdAt_idx" ON "InterruptEvent"("sessionId", "createdAt");
CREATE INDEX "InterruptEvent_tenantId_sessionId_createdAt_idx" ON "InterruptEvent"("tenantId", "sessionId", "createdAt");
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
    CONSTRAINT "Message_tenantId_sessionId_fkey" FOREIGN KEY ("tenantId", "sessionId") REFERENCES "Session" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("archived", "content", "createdAt", "id", "orderIndex", "rawJson", "role", "sessionId", "tenantId") SELECT "archived", "content", "createdAt", "id", "orderIndex", "rawJson", "role", "sessionId", "tenantId" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_sessionId_archived_orderIndex_idx" ON "Message"("sessionId", "archived", "orderIndex");
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
CREATE INDEX "Message_tenantId_sessionId_createdAt_idx" ON "Message"("tenantId", "sessionId", "createdAt");
CREATE UNIQUE INDEX "Message_sessionId_orderIndex_key" ON "Message"("sessionId", "orderIndex");
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
    CONSTRAINT "ModelCall_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AgentRun" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ModelCall" ("agentName", "completionTokens", "createdAt", "errorMessage", "estimatedCostUsd", "finishedAt", "id", "inputSummary", "latencyMs", "model", "nodeName", "outputSummary", "promptTokens", "provider", "reasoningTokens", "runId", "sessionId", "status", "stepId", "tenantId") SELECT "agentName", "completionTokens", "createdAt", "errorMessage", "estimatedCostUsd", "finishedAt", "id", "inputSummary", "latencyMs", "model", "nodeName", "outputSummary", "promptTokens", "provider", "reasoningTokens", "runId", "sessionId", "status", "stepId", "tenantId" FROM "ModelCall";
DROP TABLE "ModelCall";
ALTER TABLE "new_ModelCall" RENAME TO "ModelCall";
CREATE INDEX "ModelCall_runId_createdAt_idx" ON "ModelCall"("runId", "createdAt");
CREATE INDEX "ModelCall_sessionId_createdAt_idx" ON "ModelCall"("sessionId", "createdAt");
CREATE INDEX "ModelCall_tenantId_sessionId_createdAt_idx" ON "ModelCall"("tenantId", "sessionId", "createdAt");
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
    CONSTRAINT "ToolCall_tenantId_sessionId_fkey" FOREIGN KEY ("tenantId", "sessionId") REFERENCES "Session" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ToolCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ToolCall" ("approvedByUser", "argsJson", "createdAt", "errorMessage", "estimatedCostUsd", "finishedAt", "id", "latencyMs", "permissions", "resultJson", "resultSummary", "riskLevel", "runId", "sessionId", "source", "startedAt", "status", "stepId", "tenantId", "toolName", "updatedAt") SELECT "approvedByUser", "argsJson", "createdAt", "errorMessage", "estimatedCostUsd", "finishedAt", "id", "latencyMs", "permissions", "resultJson", "resultSummary", "riskLevel", "runId", "sessionId", "source", "startedAt", "status", "stepId", "tenantId", "toolName", "updatedAt" FROM "ToolCall";
DROP TABLE "ToolCall";
ALTER TABLE "new_ToolCall" RENAME TO "ToolCall";
CREATE INDEX "ToolCall_sessionId_createdAt_idx" ON "ToolCall"("sessionId", "createdAt");
CREATE INDEX "ToolCall_runId_createdAt_idx" ON "ToolCall"("runId", "createdAt");
CREATE INDEX "ToolCall_stepId_createdAt_idx" ON "ToolCall"("stepId", "createdAt");
CREATE INDEX "ToolCall_tenantId_sessionId_createdAt_idx" ON "ToolCall"("tenantId", "sessionId", "createdAt");
CREATE INDEX "ToolCall_tenantId_createdAt_idx" ON "ToolCall"("tenantId", "createdAt");
CREATE UNIQUE INDEX "ToolCall_tenantId_id_key" ON "ToolCall"("tenantId", "id");

-- Optional-parent tenant consistency triggers (SetNull FKs cannot include required tenantId)
CREATE TRIGGER "AgentRun_tenant_session_ins"
BEFORE INSERT ON "AgentRun"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AgentRun.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "AgentRun_tenant_session_upd"
BEFORE UPDATE OF "sessionId", "tenantId" ON "AgentRun"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AgentRun.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;

CREATE TRIGGER "AgentStep_tenant_session_ins"
BEFORE INSERT ON "AgentStep"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AgentStep.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "AgentStep_tenant_session_upd"
BEFORE UPDATE OF "sessionId", "tenantId" ON "AgentStep"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AgentStep.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;

CREATE TRIGGER "ToolCall_tenant_run_ins"
BEFORE INSERT ON "ToolCall"
FOR EACH ROW WHEN NEW."runId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ToolCall.runId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentRun" r WHERE r."id" = NEW."runId" AND r."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ToolCall_tenant_run_upd"
BEFORE UPDATE OF "runId", "tenantId" ON "ToolCall"
FOR EACH ROW WHEN NEW."runId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ToolCall.runId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentRun" r WHERE r."id" = NEW."runId" AND r."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ToolCall_tenant_step_ins"
BEFORE INSERT ON "ToolCall"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ToolCall.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ToolCall_tenant_step_upd"
BEFORE UPDATE OF "stepId", "tenantId" ON "ToolCall"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ToolCall.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;

CREATE TRIGGER "AuditLog_tenant_session_ins"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AuditLog.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "AuditLog_tenant_session_upd"
BEFORE UPDATE OF "sessionId", "tenantId" ON "AuditLog"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AuditLog.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "AuditLog_tenant_toolcall_ins"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW WHEN NEW."toolCallId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AuditLog.toolCallId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "ToolCall" t WHERE t."id" = NEW."toolCallId" AND t."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "AuditLog_tenant_toolcall_upd"
BEFORE UPDATE OF "toolCallId", "tenantId" ON "AuditLog"
FOR EACH ROW WHEN NEW."toolCallId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: AuditLog.toolCallId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "ToolCall" t WHERE t."id" = NEW."toolCallId" AND t."tenantId" = NEW."tenantId"
  );
END;

CREATE TRIGGER "InterruptEvent_tenant_session_ins"
BEFORE INSERT ON "InterruptEvent"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: InterruptEvent.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "InterruptEvent_tenant_session_upd"
BEFORE UPDATE OF "sessionId", "tenantId" ON "InterruptEvent"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: InterruptEvent.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "InterruptEvent_tenant_step_ins"
BEFORE INSERT ON "InterruptEvent"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: InterruptEvent.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "InterruptEvent_tenant_step_upd"
BEFORE UPDATE OF "stepId", "tenantId" ON "InterruptEvent"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: InterruptEvent.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;

CREATE TRIGGER "ErrorLog_tenant_session_ins"
BEFORE INSERT ON "ErrorLog"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ErrorLog.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ErrorLog_tenant_session_upd"
BEFORE UPDATE OF "sessionId", "tenantId" ON "ErrorLog"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ErrorLog.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ErrorLog_tenant_run_ins"
BEFORE INSERT ON "ErrorLog"
FOR EACH ROW WHEN NEW."runId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ErrorLog.runId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentRun" r WHERE r."id" = NEW."runId" AND r."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ErrorLog_tenant_run_upd"
BEFORE UPDATE OF "runId", "tenantId" ON "ErrorLog"
FOR EACH ROW WHEN NEW."runId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ErrorLog.runId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentRun" r WHERE r."id" = NEW."runId" AND r."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ErrorLog_tenant_step_ins"
BEFORE INSERT ON "ErrorLog"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ErrorLog.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ErrorLog_tenant_step_upd"
BEFORE UPDATE OF "stepId", "tenantId" ON "ErrorLog"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ErrorLog.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;

CREATE TRIGGER "ModelCall_tenant_session_ins"
BEFORE INSERT ON "ModelCall"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ModelCall.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ModelCall_tenant_session_upd"
BEFORE UPDATE OF "sessionId", "tenantId" ON "ModelCall"
FOR EACH ROW WHEN NEW."sessionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ModelCall.sessionId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "Session" s WHERE s."id" = NEW."sessionId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ModelCall_tenant_step_ins"
BEFORE INSERT ON "ModelCall"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ModelCall.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;
CREATE TRIGGER "ModelCall_tenant_step_upd"
BEFORE UPDATE OF "stepId", "tenantId" ON "ModelCall"
FOR EACH ROW WHEN NEW."stepId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MISMATCH: ModelCall.stepId')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentStep" s WHERE s."id" = NEW."stepId" AND s."tenantId" = NEW."tenantId"
  );
END;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
