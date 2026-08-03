import { prisma } from "../db/client";
import type { SessionMessage } from "./session-store";
import { RECENT_MESSAGE_WINDOW } from "./constants";

function parseStoredMessage(rawJson: string) {
  return JSON.parse(rawJson) as SessionMessage;
}

export async function getSessionSummary(
  sessionId: string,
  options: { tenantId: string }
) {
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      tenantId: options.tenantId,
    },
    select: {
      summary: true,
      summaryUpdatedAt: true,
    },
  });

  return session ?? { summary: null, summaryUpdatedAt: null };
}

export async function updateSessionSummary(
  sessionId: string,
  summary: string | null,
  options: { tenantId: string }
) {
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      tenantId: options.tenantId,
    },
    data: {
      summary,
      summaryUpdatedAt: summary?.trim() ? new Date() : null,
    },
  });
}

export async function getMessageCount(
  sessionId: string,
  options: { tenantId: string; archived?: boolean }
) {
  return prisma.message.count({
    where: {
      tenantId: options.tenantId,
      sessionId,
      ...(typeof options.archived === "boolean"
        ? {
            archived: options.archived,
          }
        : {}),
    },
  });
}

export async function getOldMessagesForSummary(
  sessionId: string,
  options: {
    tenantId: string;
    preserveRecent?: number;
    limit?: number;
  }
) {
  const preserveRecent = options.preserveRecent ?? RECENT_MESSAGE_WINDOW;
  const limit = options.limit ?? 200;
  const activeCount = await getMessageCount(sessionId, {
    tenantId: options.tenantId,
    archived: false,
  });

  if (activeCount <= preserveRecent) {
    return [];
  }

  const take = Math.min(activeCount - preserveRecent, limit);
  const rows = await prisma.message.findMany({
    where: {
      tenantId: options.tenantId,
      sessionId,
      archived: false,
    },
    orderBy: {
      orderIndex: "asc",
    },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    orderIndex: row.orderIndex,
    message: parseStoredMessage(row.rawJson),
  }));
}

export async function archiveMessagesById(
  messageIds: string[],
  options: { tenantId: string; sessionId: string }
) {
  if (messageIds.length === 0) {
    return 0;
  }

  const result = await prisma.message.updateMany({
    where: {
      tenantId: options.tenantId,
      sessionId: options.sessionId,
      id: {
        in: messageIds,
      },
    },
    data: {
      archived: true,
    },
  });

  return result.count;
}
