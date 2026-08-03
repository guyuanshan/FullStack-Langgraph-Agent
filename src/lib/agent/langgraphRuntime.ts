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
import type { AuthContext } from "../auth/tenant-resolution";

type RuntimeMessage = ProviderMessage;
type RuntimeResumeCommand = Command<
  ToolConfirmationResume,
  {
    auth?: AuthContext | null;
    tenantId?: string | null;
    sessionId?: string | null;
  },
  "callModelNode" | "executeToolsNode"
>;
type RuntimeOptions = {
  auth: AuthContext;
  onFinish?: (messages: RuntimeMessage[]) => void;
  threadId: string;
  tenantId: string;
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
  threadId: string,
  tenantId: string,
  auth: AuthContext
): RuntimeGraphState {
  const defaults = createAgentState(
    structuredClone(fallbackMessages),
    undefined,
    threadId,
    null,
    tenantId,
    auth
  );

  if (!values || typeof values !== "object") {
    return defaults;
  }

  const current = values as Record<string, unknown>;

  return {
    ...defaults,
    ...current,
    auth,
    tenantId,
    sessionId: threadId,
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
  tenantId: string,
  fallbackMessages: RuntimeMessage[],
  auth: AuthContext
) {
  try {
    const snapshot = await getRuntimeThreadState(threadId);
    return toRuntimeGraphState(
      snapshot.values,
      fallbackMessages,
      threadId,
      tenantId,
      auth
    );
  } catch {
    const persistedValues = await getPersistedRuntimeThreadState(threadId, {
      tenantId,
    });

    if (persistedValues) {
      return toRuntimeGraphState(
        persistedValues,
        fallbackMessages,
        threadId,
        tenantId,
        auth
      );
    }

    return createAgentState(
      structuredClone(fallbackMessages),
      undefined,
      threadId,
      null,
      tenantId,
      auth
    );
  }
}

async function streamLangGraphInput(
  input: RuntimeMessage[] | RuntimeResumeCommand,
  options: RuntimeOptions
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to run LangGraph runtime");
  }

  const inputMessages = Array.isArray(input) ? input : [];
  const graphInput = Array.isArray(input)
    ? createAgentState(
        structuredClone(input),
        undefined,
        options.threadId,
        options.runId ?? null,
        options.tenantId,
        options.auth
      )
    : input;

  return new ReadableStream({
    async start(controller) {
      let latestState: RuntimeGraphState = createAgentState(
        structuredClone(inputMessages),
        undefined,
        options.threadId,
        options.runId ?? null,
        options.tenantId,
        options.auth
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
          if (isInterrupted(chunk)) {
            const interruptPayload = chunk[INTERRUPT][0]?.value;

            if (isToolConfirmationInterrupt(interruptPayload)) {
              let approvalId = interruptPayload.approvalId;

              // Fallback: bind a pending approval if the graph node did not.
              if (!approvalId && latestState.runId) {
                const pendingApproval = await appendInterruptEvent({
                  runId: latestState.runId,
                  tenantId: options.tenantId,
                  sessionId: latestState.sessionId,
                  kind: "tool_confirmation",
                  status: "pending",
                  message: interruptPayload.message,
                  payload: {
                    toolName: interruptPayload.toolName,
                    toolCallId: interruptPayload.toolCallId,
                    args: interruptPayload.args,
                    toolSummary: interruptPayload.toolSummary,
                    riskLevel:
                      interruptPayload.toolRiskLevel ?? "dangerous",
                    permissions: interruptPayload.toolPermissions ?? [],
                  },
                });
                approvalId = pendingApproval.id;
              }

              if (!approvalId) {
                throw new Error(
                  "Tool confirmation is missing a server approvalId."
                );
              }

              controller.enqueue(
                encodeSSE({
                  type: "confirm_request",
                  approvalId,
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

            latestState = await loadLatestThreadState(
              options.threadId,
              options.tenantId,
              inputMessages,
              options.auth
            );
            await persistRuntimeThreadState(options.threadId, {
              tenantId: options.tenantId,
            });
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
                tenantId: options.tenantId,
                sessionId: options.threadId,
                status: "interrupted",
                completionReason: "interrupted",
              });
            }
            options.onFinish?.(structuredClone(latestState.messages));
            controller.close();
            return;
          }

          latestState = {
            ...chunk,
            auth: options.auth,
            tenantId: options.tenantId,
            sessionId: options.threadId,
          };

          const nextEvents = chunk.events ?? [];
          if (nextEvents.length > 0) {
            enqueueEvents(controller, nextEvents);
          }
        }

        latestState = await loadLatestThreadState(
          options.threadId,
          options.tenantId,
          inputMessages,
          options.auth
        );
        await persistRuntimeThreadState(options.threadId, {
          tenantId: options.tenantId,
        });
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
            tenantId: options.tenantId,
            sessionId: options.threadId,
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
            tenantId: options.tenantId,
            sessionId: latestState.sessionId,
            source: "langgraph_runtime",
            error,
            context: {
              threadId: options.threadId,
            },
          });
          await completeAgentRun({
            runId: latestState.runId,
            tenantId: options.tenantId,
            sessionId: options.threadId,
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
      {
        auth?: AuthContext | null;
        tenantId?: string | null;
        sessionId?: string | null;
      },
      "callModelNode" | "executeToolsNode"
    >({
      resume,
      update: {
        auth: options.auth,
        tenantId: options.tenantId,
        sessionId: options.threadId,
      },
    }),
    options
  );
}
