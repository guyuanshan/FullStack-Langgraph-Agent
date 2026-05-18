export type ProviderMessage = Record<string, unknown>;

export type ProviderToolDefinition = Record<string, unknown>;

export type ProviderToolCallDelta = {
  id?: string;
  index?: number;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type ProviderToolCall = {
  id?: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ProviderStreamEvent =
  | {
      type: "text_delta";
      text: string;
    }
  | {
      type: "tool_call_delta";
      toolCall: ProviderToolCallDelta;
    };

export type CreateChatStreamOptions = {
  tools?: ProviderToolDefinition[];
};

export interface ChatStream {
  events: AsyncIterable<ProviderStreamEvent>;
  getAssistantMessage(): ProviderMessage | null;
}

export interface ChatProvider {
  createChatStream(
    messages: ProviderMessage[],
    options?: CreateChatStreamOptions
  ): Promise<ChatStream>;
}
