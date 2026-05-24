import {
  CONTEXT_SYSTEM_MESSAGE_PREFIX,
  PROJECT_MEMORY_MESSAGE_PREFIX,
  RECENT_MESSAGE_WINDOW,
  SUMMARY_MESSAGE_PREFIX,
} from "./constants";
import { getSessionMessages, type SessionMessage } from "./session-store";
import { getSessionSummary } from "./summary-store";
import {
  renderRetrievedMemories,
  retrieveProjectMemories,
} from "../project-memory";

export function createContextSystemMessage(): SessionMessage {
  return {
    role: "system",
    content: [
      CONTEXT_SYSTEM_MESSAGE_PREFIX,
      "Use the conversation summary as durable memory, rely on recent messages for the latest details, and avoid repeating stale tool output.",
    ].join("\n\n"),
  };
}

export function createSummaryMessage(summary: string): SessionMessage {
  return {
    role: "system",
    content: `${SUMMARY_MESSAGE_PREFIX}\n\n${summary}`,
  };
}

export function createProjectMemoryMessage(memoryText: string): SessionMessage {
  return {
    role: "system",
    content: `${PROJECT_MEMORY_MESSAGE_PREFIX}\n\n${memoryText}`,
  };
}

export function isEphemeralContextMessage(message: SessionMessage) {
  const role = message.role;
  const content = message.content;

  return (
    role === "system" &&
    typeof content === "string" &&
    (content.startsWith(SUMMARY_MESSAGE_PREFIX) ||
      content.startsWith(CONTEXT_SYSTEM_MESSAGE_PREFIX) ||
      content.startsWith(PROJECT_MEMORY_MESSAGE_PREFIX))
  );
}

export async function buildAgentContext(sessionId: string, latestUserQuery?: string) {
  const [{ summary }, recentMessages, retrievedMemoryPayload] = await Promise.all([
    getSessionSummary(sessionId),
    getSessionMessages(sessionId, {
      includeSummary: false,
      recentLimit: RECENT_MESSAGE_WINDOW,
    }),
    latestUserQuery?.trim()
      ? retrieveProjectMemories({
          query: latestUserQuery,
          topK: 6,
        })
      : Promise.resolve(null),
  ]);

  const context: SessionMessage[] = [createContextSystemMessage()];

  if (summary?.trim()) {
    context.push(createSummaryMessage(summary));
  }

  const renderedMemories = retrievedMemoryPayload
    ? renderRetrievedMemories(retrievedMemoryPayload.results)
    : null;

  if (renderedMemories) {
    context.push(createProjectMemoryMessage(renderedMemories));
  }

  return [...context, ...recentMessages];
}
