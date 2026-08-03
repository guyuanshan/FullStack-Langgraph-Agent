import { prisma } from "../db/client";
import { resolveWriteTenantId } from "../db/tenant";
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

export async function ensureSession(
  sessionId: string,
  options?: {
    tenantId?: string;
    userId?: string | null;
  }
) {
  const existing = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      tenantId: true,
      userId: true,
    },
  });

  if (existing) {
    if (options?.tenantId && existing.tenantId !== options.tenantId) {
      throw new Error(
        `Session ${sessionId} belongs to tenant ${existing.tenantId}, not ${options.tenantId}.`
      );
    }

    if (options?.userId && !existing.userId) {
      return prisma.session.update({
        where: {
          id: sessionId,
        },
        data: {
          userId: options.userId,
        },
      });
    }

    return existing;
  }

  if (!options?.tenantId) {
    throw new Error("tenantId is required to create a session");
  }

  return prisma.session.create({
    data: {
      id: sessionId,
      tenantId: options.tenantId,
      userId: options.userId ?? null,
    },
  });
}

export async function getSessionMessages(
  sessionId: string,
  options?: {
    tenantId: string;
    includeSummary?: boolean;
    recentLimit?: number;
  }
) {
  if (!options?.tenantId) {
    throw new Error("tenantId is required to read session messages");
  }

  const recentLimit = options?.recentLimit ?? DEFAULT_RECENT_MESSAGE_LIMIT;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      tenantId: options.tenantId,
    },
    select: {
      summary: true,
    },
  });
  const rows = await prisma.message.findMany({
    where: {
      tenantId: options.tenantId,
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

export async function getFullSessionMessages(
  sessionId: string,
  options: { tenantId: string }
) {
  const rows = await prisma.message.findMany({
    where: {
      tenantId: options.tenantId,
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
  messages: SessionMessage[],
  options: { tenantId: string }
) {
  const nextMessages = structuredClone(messages);
  const tenantId = await resolveWriteTenantId({
    tenantId: options.tenantId,
    sessionId,
  });
  const existingCount = await prisma.message.count({
    where: {
      tenantId,
      sessionId,
    },
  });
  const messagesToAppend = nextMessages
    .slice(existingCount)
    .map((message) => sanitizeMessageForStorage(message));

  if (messagesToAppend.length > 0) {
    await prisma.message.createMany({
      data: messagesToAppend.map((message, index) => ({
        tenantId,
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

  await prisma.session.updateMany({
    where: {
      id: sessionId,
      tenantId,
    },
    data: {
      messageCount: nextCount,
      lastMessageAt: new Date(),
    },
  });
}

export async function cloneSessionMessages(
  sessionId: string,
  options: {
    tenantId: string;
    includeSummary?: boolean;
    recentLimit?: number;
  }
) {
  return structuredClone(await getSessionMessages(sessionId, options));
}
