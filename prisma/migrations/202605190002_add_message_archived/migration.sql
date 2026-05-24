ALTER TABLE "Message" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Message_sessionId_archived_orderIndex_idx"
ON "Message"("sessionId", "archived", "orderIndex");
