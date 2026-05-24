import { prisma } from "../db/client";
import type { SessionMessage } from "./session-store";
import { RECENT_MESSAGE_WINDOW } from "./constants";

function parseStoredMessage(rawJson: string) {
  return JSON.parse(rawJson) as SessionMessage;
}

export async function getSessionSummary(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
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
  summary: string | null
) {
  await prisma.session.update({
    where: {
      id: sessionId,
    },
    data: {
      summary,
      summaryUpdatedAt: summary?.trim() ? new Date() : null,
    },
  });
}

export async function getMessageCount(sessionId: string, options?: { archived?: boolean }) {
  return prisma.message.count({
    where: {
      sessionId,
      ...(typeof options?.archived === "boolean"
        ? {
            archived: options.archived,
          }
        : {}),
    },
  });
}

export async function getOldMessagesForSummary(
  sessionId: string,
  options?: {
    preserveRecent?: number;
    limit?: number;
  }
) {
  const preserveRecent = options?.preserveRecent ?? RECENT_MESSAGE_WINDOW;
  const limit = options?.limit ?? 200;
  const activeCount = await getMessageCount(sessionId, {
    archived: false,
  });

  if (activeCount <= preserveRecent) {
    return [];
  }

  const take = Math.min(activeCount - preserveRecent, limit);
  const rows = await prisma.message.findMany({
    where: {
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

export async function archiveMessagesById(messageIds: string[]) {
  if (messageIds.length === 0) {
    return 0;
  }

  const result = await prisma.message.updateMany({
    where: {
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
