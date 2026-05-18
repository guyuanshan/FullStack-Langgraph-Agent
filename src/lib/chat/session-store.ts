export type SessionMessage = Record<string, unknown>;

const sessionStore = new Map<string, SessionMessage[]>();

export function getSessionMessages(sessionId: string) {
  return sessionStore.get(sessionId) ?? [];
}

export function setSessionMessages(
  sessionId: string,
  messages: SessionMessage[]
) {
  sessionStore.set(sessionId, structuredClone(messages));
}

export function cloneSessionMessages(sessionId: string) {
  return structuredClone(getSessionMessages(sessionId));
}
