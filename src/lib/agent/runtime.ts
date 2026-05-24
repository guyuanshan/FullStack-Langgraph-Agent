import type { ProviderMessage } from "../../lib/ai/providers/types";
import { encodeSSE } from "../stream/sse";
import {
  createAgentState,
  type AgentState,
} from "./state";
import {
  callModelNode,
  executeToolsNode,
  flushStateEvents,
  shouldContinue,
} from "./nodes";
import {
  appendErrorLog,
  completeAgentRun,
  completeAgentStep,
  createAgentStep,
} from "../observability/store";

type RuntimeMessage = ProviderMessage;
type RuntimeOptions = {
  onFinish?: (messages: RuntimeMessage[]) => void;
  sessionId?: string;
  runId?: string;
};

const MAX_STEPS_ERROR_MESSAGE = "Agent Runtime Error";

function getErrorMessage(error: unknown) { // 获取错误信息的工具函数
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function finishRuntime( // 结束运行的函数，处理运行结束的逻辑
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: AgentState,
  options: RuntimeOptions
) {
  if (state.completionReason === "max_steps") {
    state.events.push({
      type: "error",
      message: MAX_STEPS_ERROR_MESSAGE,
    });
    flushStateEvents(controller, state);
  }

  options.onFinish?.(structuredClone(state.messages));
  if (state.runId) {
    controller.enqueue(
      encodeSSE({
        type: "run_finished",
        runId: state.runId,
        status: "completed",
        completionReason: state.completionReason ?? "completed",
      })
    );
  }
  if (state.runId) {
    void completeAgentRun({
      runId: state.runId,
      status: "completed",
      completionReason: state.completionReason ?? "completed",
    });
  }
  controller.close();
}

async function advanceRuntime( // 推进运行的函数，根据当前状态执行相应的节点逻辑，并判断是否继续推进
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: AgentState,
  options: RuntimeOptions
): Promise<void> {
  if (state.currentNode === "done") {
    finishRuntime(controller, state, options);
    return;
  }

  if (state.currentNode === "model") {
    const stepId = state.runId
      ? await createAgentStep({
          runId: state.runId,
          sessionId: state.sessionId,
          agentName: "assistant",
          nodeName: "callModelNode",
          stepType: "model_node",
          input: {
            step: state.step,
          },
        })
      : null;
    try {
      state.activeStepId = stepId;
      await callModelNode(state);
      state.activeStepId = null;
      if (stepId) {
        await completeAgentStep({
          stepId,
          output: {
            toolCallCount: state.toolCalls.length,
          },
        });
      }
    } catch (error) {
      state.activeStepId = null;
      if (stepId) {
        await completeAgentStep({
          stepId,
          status: "error",
        });
      }
      if (state.runId) {
        await appendErrorLog({
          runId: state.runId,
          stepId,
          sessionId: state.sessionId,
          source: "manual_callModelNode",
          error,
          context: {
            step: state.step,
          },
        });
      }
      throw error;
    }
    flushStateEvents(controller, state);
  } else {
    const stepId = state.runId
      ? await createAgentStep({
          runId: state.runId,
          sessionId: state.sessionId,
          agentName: "assistant",
          nodeName: "executeToolsNode",
          stepType: "tool_node",
          input: {
            toolCalls: state.toolCalls.map((toolCall) => toolCall.function.name),
          },
        })
      : null;
    try {
      state.activeStepId = stepId;
      await executeToolsNode(state);
      state.activeStepId = null;
      if (stepId) {
        await completeAgentStep({
          stepId,
          output: {
            toolCallCount: state.toolCalls.length,
          },
        });
      }
    } catch (error) {
      state.activeStepId = null;
      if (stepId) {
        await completeAgentStep({
          stepId,
          status: "error",
        });
      }
      if (state.runId) {
        await appendErrorLog({
          runId: state.runId,
          stepId,
          sessionId: state.sessionId,
          source: "manual_executeToolsNode",
          error,
          context: {
            step: state.step,
          },
        });
      }
      throw error;
    }
    flushStateEvents(controller, state);
  }

  const nextState = shouldContinue(state);

  if (nextState.currentNode === "done") {
    finishRuntime(controller, nextState, options);
    return;
  }

  await advanceRuntime(controller, nextState, options);
}

export async function runAgentRuntime(
  messages: RuntimeMessage[],
  options: RuntimeOptions = {}
) {
  const state = createAgentState(
    messages,
    undefined,
    options.sessionId ?? null,
    options.runId ?? null
  );

  return new ReadableStream({
    async start(controller) {
      try {
        if (state.runId) {
          controller.enqueue(
            encodeSSE({
              type: "run_started",
              runId: state.runId,
              runtimeType: "manual",
            })
          );
        }
        await advanceRuntime(controller, state, options);
      } catch (error) {
        console.error(error);
        const message = getErrorMessage(error);

        state.completionReason = "error";
        state.events.push({
          type: "error",
          message,
        });
        flushStateEvents(controller, state);
        if (state.runId) {
          controller.enqueue(
            encodeSSE({
              type: "run_finished",
              runId: state.runId,
              status: "error",
              completionReason: "error",
            })
          );
        }
        if (state.runId) {
          await appendErrorLog({
            runId: state.runId,
            sessionId: state.sessionId,
            source: "manual_runtime",
            error,
          });
          await completeAgentRun({
            runId: state.runId,
            status: "error",
            completionReason: "error",
            errorMessage: message,
          });
        }
        options.onFinish?.(structuredClone(state.messages));
        controller.close();
      }
    },
  });
}
