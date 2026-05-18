import type { StreamEvent } from "../../types/chat";

export function encodeSSE(event: StreamEvent) {
  return new TextEncoder().encode(JSON.stringify(event) + "\n");
}
