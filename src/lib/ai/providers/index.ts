import { deepSeekProvider } from "./deepseek";
import type { ChatProvider } from "./types";

export function getDefaultChatProvider(): ChatProvider {
  return deepSeekProvider;
}
