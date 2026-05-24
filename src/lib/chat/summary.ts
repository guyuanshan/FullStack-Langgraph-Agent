import type { SessionMessage } from "./session-store";

const DEFAULT_SUMMARY_TRIGGER = 20;
const DEFAULT_RECENT_WINDOW = 20;

function messageToSummaryLine(message: SessionMessage) {
  const role = typeof message.role === "string" ? message.role : "unknown";
  const content = typeof message.content === "string" ? message.content : "";
  const compact = content.replace(/\s+/g, " ").trim();

  if (!compact) {
    return null;
  }

  return `${role}: ${compact.slice(0, 240)}`;
}

export function shouldRefreshConversationSummary(messageCount: number) {
  return messageCount >= DEFAULT_SUMMARY_TRIGGER;
}

export function buildConversationSummary(
  previousSummary: string | null | undefined,
  olderMessages: SessionMessage[]
) {
  const lines = olderMessages
    .map(messageToSummaryLine)
    .filter((line): line is string => !!line)
    .slice(-12);

  if (lines.length === 0) {
    return previousSummary ?? null;
  }

  const nextSections = [];

  if (previousSummary?.trim()) {
    nextSections.push(previousSummary.trim());
  }

  nextSections.push("Recent conversation memory:");
  nextSections.push(...lines);

  return nextSections.join("\n");
}

export function splitMessagesForSummary(messages: SessionMessage[]) {
  if (messages.length <= DEFAULT_RECENT_WINDOW) {
    return {
      olderMessages: [] as SessionMessage[],
      recentMessages: messages,
    };
  }

  return {
    olderMessages: messages.slice(0, -DEFAULT_RECENT_WINDOW),
    recentMessages: messages.slice(-DEFAULT_RECENT_WINDOW),
  };
}
