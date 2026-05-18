import type { ProviderMessage } from "../../lib/ai/providers/types";
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

type RuntimeMessage = ProviderMessage;
type RuntimeOptions = {
  onFinish?: (messages: RuntimeMessage[]) => void;
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
    await callModelNode(state);
    flushStateEvents(controller, state);
  } else {
    await executeToolsNode(state);
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
  const state = createAgentState(messages);

  return new ReadableStream({
    async start(controller) {
      try {
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
        options.onFinish?.(structuredClone(state.messages));
        controller.close();
      }
    },
  });
}
