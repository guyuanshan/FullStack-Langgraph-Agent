import OpenAI from "openai";
import type {
  ChatProvider,
  ChatStream,
  CreateChatStreamOptions,
  ProviderMessage,
  ProviderStreamEvent,
  ProviderToolCall,
} from "./types";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

type DeepSeekChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id?: string;
        index?: number;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

function createEmptyToolCall(id?: string): ProviderToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "",
      arguments: "",
    },
  };
}

class DeepSeekProvider implements ChatProvider {
  async createChatStream(
    messages: ProviderMessage[],
    options: CreateChatStreamOptions = {}
  ): Promise<ChatStream> {
    const response = await client.chat.completions.create({
      model: "deepseek-v4-flash",
      messages,
      tools:
        options.tools as unknown as OpenAI.Chat.ChatCompletionTool[] | undefined,
      stream: true,
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

    let assistantContent = "";
    let reasoningContent = "";
    const toolCalls: ProviderToolCall[] = [];

    const events = (async function* (): AsyncIterable<ProviderStreamEvent> {
      for await (const chunk of response as AsyncIterable<DeepSeekChunk>) {
        const delta = chunk.choices?.[0]?.delta;

        if (delta?.content) {
          assistantContent += delta.content;
          yield {
            type: "text_delta",
            text: delta.content,
          };
        }

        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }

        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index ?? 0;

            if (!toolCalls[index]) {
              toolCalls[index] = createEmptyToolCall(toolCall.id);
            }

            if (toolCall.id) {
              toolCalls[index].id = toolCall.id;
            }

            if (toolCall.function?.name) {
              toolCalls[index].function.name += toolCall.function.name;
            }

            if (toolCall.function?.arguments) {
              toolCalls[index].function.arguments += toolCall.function.arguments;
            }

            yield {
              type: "tool_call_delta",
              toolCall,
            };
          }
        }
      }
    })();

    return {
      events,
      getAssistantMessage() {
        if (!assistantContent && toolCalls.length === 0) {
          return null;
        }

        return {
          role: "assistant",
          content: assistantContent || null,
          reasoning_content: reasoningContent || undefined,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        };
      },
    };
  }
}

export const deepSeekProvider = new DeepSeekProvider();
