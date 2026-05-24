import { prisma } from "../db/client";
import { RECENT_MESSAGE_WINDOW, SUMMARY_MESSAGE_PREFIX } from "./constants";
import { summarizeToolResult } from "../tools/summary";

export type SessionMessage = Record<string, unknown>;

const DEFAULT_RECENT_MESSAGE_LIMIT = RECENT_MESSAGE_WINDOW;
const MAX_TOOL_CONTEXT_CHARS = 1200;

function normalizeMessageRole(message: SessionMessage) {
  return typeof message.role === "string" ? message.role : "unknown";
}

function normalizeMessageContent(message: SessionMessage) {
  return typeof message.content === "string" ? message.content : null;
}

function summarizeStoredToolMessage(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    const summary = summarizeToolResult(parsed);

    return JSON.stringify({
      kind: "tool_result_summary",
      summary,
    });
  } catch {
    return JSON.stringify({
      kind: "tool_result_summary",
      summary: compactToolContent(content),
    });
  }
}

function sanitizeMessageForStorage(message: SessionMessage): SessionMessage {
  if (message.role !== "tool" || typeof message.content !== "string") {
    return message;
  }

  return {
    ...message,
    content: summarizeStoredToolMessage(message.content),
  };
}

function createSummaryMessage(summary: string) {
  return {
    role: "system",
    content: `${SUMMARY_MESSAGE_PREFIX}\n\n${summary}`,
  };
}

function compactToolContent(content: string) {
  if (content.length <= MAX_TOOL_CONTEXT_CHARS) {
    return content;
  }

  const compactPayload = {
    summary: "Tool result was truncated for context efficiency.",
    excerpt: content.slice(0, MAX_TOOL_CONTEXT_CHARS),
    omittedChars: content.length - MAX_TOOL_CONTEXT_CHARS,
  };

  return JSON.stringify(compactPayload);
}

function compactMessageForContext(message: SessionMessage) {
  if (message.role !== "tool" || typeof message.content !== "string") {
    return message;
  }

  return {
    ...message,
    content: compactToolContent(message.content),
  };
}

export async function ensureSession(sessionId: string) {
  return prisma.session.upsert({
    where: {
      id: sessionId,
    },
    update: {},
    create: {
      id: sessionId,
    },
  });
}

export async function getSessionMessages(
  sessionId: string,
  options?: {
    includeSummary?: boolean;
    recentLimit?: number;
  }
) {
  const recentLimit = options?.recentLimit ?? DEFAULT_RECENT_MESSAGE_LIMIT;
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      summary: true,
    },
  });
  const rows = await prisma.message.findMany({
    where: {
      sessionId,
      ...(recentLimit > 0
        ? {
            archived: false,
          }
        : {}),
    },
    orderBy:
      recentLimit > 0
        ? {
            orderIndex: "desc",
          }
        : {
            orderIndex: "asc",
          },
    ...(recentLimit > 0 ? { take: recentLimit } : {}),
  });
  const messages = rows
    .reverse()
    .map((row) => JSON.parse(row.rawJson) as SessionMessage)
    .map((message) =>
      options?.includeSummary ? compactMessageForContext(message) : message
    );

  if (options?.includeSummary && session?.summary?.trim()) {
    return [createSummaryMessage(session.summary), ...messages];
  }

  return messages;
}

export async function getFullSessionMessages(sessionId: string) {
  const rows = await prisma.message.findMany({
    where: {
      sessionId,
    },
    orderBy: {
      orderIndex: "asc",
    },
  });

  return rows.map((row) => JSON.parse(row.rawJson) as SessionMessage);
}

export async function setSessionMessages(
  sessionId: string,
  messages: SessionMessage[]
) {
  const nextMessages = structuredClone(messages);
  await ensureSession(sessionId);
  const existingCount = await prisma.message.count({
    where: {
      sessionId,
    },
  });
  const messagesToAppend = nextMessages
    .slice(existingCount)
    .map((message) => sanitizeMessageForStorage(message));

  if (messagesToAppend.length > 0) {
    await prisma.message.createMany({
      data: messagesToAppend.map((message, index) => ({
        sessionId,
        orderIndex: existingCount + index,
        role: normalizeMessageRole(message),
        content: normalizeMessageContent(message),
        rawJson: JSON.stringify(message),
        archived: false,
      })),
    });
  }

  const nextCount = existingCount + messagesToAppend.length;

  await prisma.session.update({
    where: {
      id: sessionId,
    },
    data: {
      messageCount: nextCount,
      lastMessageAt: new Date(),
    },
  });
}

export async function cloneSessionMessages(
  sessionId: string,
  options?: {
    includeSummary?: boolean;
    recentLimit?: number;
  }
) {
  return structuredClone(await getSessionMessages(sessionId, options));
}

export async function listSessions() {
  return prisma.session.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });
}

export async function deleteSession(sessionId: string) {
  await prisma.session.delete({
    where: {
      id: sessionId,
    },
  });
}
