import {
  Command,
  INTERRUPT,
  isInterrupted,
} from "@langchain/langgraph";
import {
  getPersistedRuntimeThreadState,
  persistRuntimeThreadState,
  getRuntimeThreadState,
  runtimeStateGraph,
  type RuntimeGraphState,
} from "../graph/runtime";
import type { ProviderMessage } from "../ai/providers/types";
import { encodeSSE } from "../stream/sse";
import type { StreamEvent } from "../../types/chat";
import {
  isToolConfirmationInterrupt,
  type ToolConfirmationResume,
} from "./confirmation";
import { createAgentState } from "./state";
import {
  appendErrorLog,
  appendInterruptEvent,
  completeAgentRun,
} from "../observability/store";

type RuntimeMessage = ProviderMessage;
type RuntimeResumeCommand = Command<
  ToolConfirmationResume,
  Record<string, never>,
  "callModelNode" | "executeToolsNode"
>;
type RuntimeOptions = {
  onFinish?: (messages: RuntimeMessage[]) => void;
  threadId: string;
  runId?: string;
};

const MAX_STEPS_ERROR_MESSAGE = "Agent Runtime Error";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function enqueueEvents(
  controller: ReadableStreamDefaultController<Uint8Array>,
  events: StreamEvent[]
) {
  for (const event of events) {
    controller.enqueue(encodeSSE(event));
  }
}

function toRuntimeGraphState(
  values: unknown,
  fallbackMessages: RuntimeMessage[],
  threadId: string
): RuntimeGraphState {
  const defaults = createAgentState(
    structuredClone(fallbackMessages),
    undefined,
    threadId,
    null
  );

  if (!values || typeof values !== "object") {
    return defaults;
  }

  const current = values as Record<string, unknown>;

  return {
    ...defaults,
    ...current,
    messages: Array.isArray(current.messages)
      ? (current.messages as RuntimeMessage[])
      : defaults.messages,
    toolCalls: Array.isArray(current.toolCalls)
      ? current.toolCalls
      : defaults.toolCalls,
    events: Array.isArray(current.events) ? current.events : [],
  };
}

async function loadLatestThreadState(
  threadId: string,
  fallbackMessages: RuntimeMessage[]
) {
  try {
    const snapshot = await getRuntimeThreadState(threadId);
    return toRuntimeGraphState(snapshot.values, fallbackMessages, threadId);
  } catch {
    const persistedValues = await getPersistedRuntimeThreadState(threadId);

    if (persistedValues) {
      return toRuntimeGraphState(persistedValues, fallbackMessages, threadId);
    }

    return createAgentState(
      structuredClone(fallbackMessages),
      undefined,
      threadId,
      null
    );
  }
}

async function streamLangGraphInput(
  input: RuntimeMessage[] | RuntimeResumeCommand,
  options: RuntimeOptions
) {
  const inputMessages = Array.isArray(input) ? input : [];
  const graphInput = Array.isArray(input)
    ? createAgentState(
        structuredClone(input),
        undefined,
        options.threadId,
        options.runId ?? null
      )
    : input;

  return new ReadableStream({
    async start(controller) {
      let latestState: RuntimeGraphState = createAgentState(
        structuredClone(inputMessages),
        undefined,
        options.threadId,
        options.runId ?? null
      );

      try {
        if (options.runId) {
          controller.enqueue(
            encodeSSE({
              type: "run_started",
              runId: options.runId,
              runtimeType: "langgraph",
            })
          );
        }
        const stream = await runtimeStateGraph.stream(graphInput, {
          streamMode: "values",
          configurable: {
            thread_id: options.threadId,
          },
        });

        for await (const chunk of stream as AsyncIterable<RuntimeGraphState>) {
          if (isInterrupted(chunk)) { // 如果当前块是一个中断，检查是否是工具确认的中断，如果是则发送一个确认请求事件，并等待用户的决策 
            const interruptPayload = chunk[INTERRUPT][0]?.value; // 获取中断的负载，假设只有一个中断请求

            if (isToolConfirmationInterrupt(interruptPayload)) { // 如果中断请求是一个工具确认的中断，发送一个事件到前端，询问用户是否允许执行工具
              if (latestState.runId) {
                await appendInterruptEvent({
                  runId: latestState.runId,
                  sessionId: latestState.sessionId,
                  kind: "tool_confirmation",
                  status: "pending",
                  message: interruptPayload.message,
                  payload: {
                    toolName: interruptPayload.toolName,
                    toolCallId: interruptPayload.toolCallId,
                    args: interruptPayload.args,
                  },
                });
              }
              controller.enqueue(
                encodeSSE({
                  type: "confirm_request",
                  toolName: interruptPayload.toolName,
                  toolCallId: interruptPayload.toolCallId,
                  args: interruptPayload.args,
                  message: interruptPayload.message,
                  toolSummary: interruptPayload.toolSummary,
                  toolRiskLevel: interruptPayload.toolRiskLevel,
                  toolPermissions: interruptPayload.toolPermissions,
                })
              );
            }

            latestState = await loadLatestThreadState( // 在等待用户决策的过程中，持续加载最新的线程状态，以便在用户做出决策后能够获取到最新的状态
              options.threadId,
              inputMessages
            );
            await persistRuntimeThreadState(options.threadId);
            if (latestState.runId) {
              controller.enqueue(
                encodeSSE({
                  type: "run_finished",
                  runId: latestState.runId,
                  status: "interrupted",
                  completionReason: "interrupted",
                })
              );
              await completeAgentRun({
                runId: latestState.runId,
                status: "interrupted",
                completionReason: "interrupted",
              });
            }
            options.onFinish?.(structuredClone(latestState.messages)); // 在用户做出决策后，调用 onFinish 回调函数，传入最新状态的消息列表
            controller.close();
            return;
          }

          latestState = chunk; // 如果当前块不是一个中断，说明是一个正常的状态更新，直接将其中的事件发送到前端，并更新最新的状态

          const nextEvents = chunk.events ?? [];
          if (nextEvents.length > 0) {
            enqueueEvents(controller, nextEvents);
          }
        }

        latestState = await loadLatestThreadState(options.threadId, inputMessages);
        await persistRuntimeThreadState(options.threadId);
        if (latestState.runId) {
          controller.enqueue(
            encodeSSE({
              type: "run_finished",
              runId: latestState.runId,
              status: "completed",
              completionReason: latestState.completionReason ?? "completed",
            })
          );
          await completeAgentRun({
            runId: latestState.runId,
            status: "completed",
            completionReason: latestState.completionReason ?? "completed",
          });
        }

        if (latestState.completionReason === "max_steps") {
          controller.enqueue(
            encodeSSE({
              type: "error",
              message: MAX_STEPS_ERROR_MESSAGE,
            })
          );
        }

        options.onFinish?.(structuredClone(latestState.messages));
        controller.close();
      } catch (error) {
        console.error(error);
        if (latestState.runId) {
          controller.enqueue(
            encodeSSE({
              type: "run_finished",
              runId: latestState.runId,
              status: "error",
              completionReason: "error",
            })
          );
          await appendErrorLog({
            runId: latestState.runId,
            sessionId: latestState.sessionId,
            source: "langgraph_runtime",
            error,
            context: {
              threadId: options.threadId,
            },
          });
          await completeAgentRun({
            runId: latestState.runId,
            status: "error",
            completionReason: "error",
            errorMessage: getErrorMessage(error),
          });
        }
        controller.enqueue(
          encodeSSE({
            type: "error",
            message: getErrorMessage(error),
          })
        );
        options.onFinish?.(structuredClone(latestState.messages));
        controller.close();
      }
    },
  });
}

export async function runLangGraphRuntime(
  messages: RuntimeMessage[],
  options: RuntimeOptions
) {
  return streamLangGraphInput(messages, options);
}

export async function resumeLangGraphRuntime(
  resume: ToolConfirmationResume,
  options: RuntimeOptions
) {
  return streamLangGraphInput(
    new Command<
      ToolConfirmationResume,
      Record<string, never>,
      "callModelNode" | "executeToolsNode"
    >({ resume }),
    options
  );
}
