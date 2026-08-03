import {
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
} from "@langchain/langgraph";
import { getDefaultChatProvider } from "../ai/providers";
import type {
  ProviderMessage,
  ProviderToolCall,
  ProviderToolDefinition,
} from "../ai/providers/types";
import { ensureSession } from "../chat";
import {
  requireSessionInTenant,
  upsertTenantCheckpoint,
} from "../db/tenant-access";
import { encodeSSE } from "../stream/sse";
import { getProviderTools } from "../tools";
import {
  collectToolCall,
  executeSingleToolCall,
  parseToolCallArgs,
} from "../agent/nodes";
import type { StreamEvent } from "../../types/chat";
import {
  createSubtaskPrompt,
  createExecutorPrompt,
  createPlanSummary,
  createPlannerPrompt,
  createReviewerPrompt,
  createSynthesisPrompt,
  createFinalizerPrompt,
  isPlannerOutput,
  isReviewerOutput,
} from "./prompts";
import {
  createFallbackPlan,
  classifyTaskKind,
  filterToolNamesForAgent,
  getPrimaryExecutionAgent,
  shouldRequirePlanApproval,
} from "./router";
import {
  createMultiAgentState,
  MultiAgentGraphState,
  type RuntimeMultiAgentState,
} from "./state";
import { appendAgentTrace } from "./store";
import { buildApprovalPayload } from "../api/pending-approvals";
import {
  appendErrorLog,
  appendInterruptEvent,
  appendModelCall,
  completeAgentRun,
  completeAgentStep,
  createAgentStep,
  estimateTokenCount,
} from "../observability/store";
import type {
  AgentObservation,
  AgentRole,
  MultiAgentState,
  PlannerOutput,
  ReviewerOutput,
  SubtaskResult,
} from "./types";
import type { AuthContext } from "../auth/tenant-resolution";

const multiAgentMemorySaver = new MemorySaver();
const liveRunEventEmitters = new Map<
  string,
  (event: StreamEvent) => void
>();

type MultiAgentResume = {
  approved: boolean;
  reason?: string;
};
type MultiAgentResumeCommand = Command<
  MultiAgentResume,
  {
    auth?: AuthContext | null;
    tenantId?: string | null;
    sessionId?: string | null;
  },
  "planner" | "executor" | "reviewer" | "finalizer"
>;

function registerLiveRunEmitter(
  runId: string,
  emitEvent: (event: StreamEvent) => void
) {
  liveRunEventEmitters.set(runId, emitEvent);
}

function unregisterLiveRunEmitter(runId: string) {
  liveRunEventEmitters.delete(runId);
}

function emitLiveRunEvent(runId: string | null, event: StreamEvent) {
  if (!runId) {
    return;
  }

  liveRunEventEmitters.get(runId)?.(event);
}

function cloneState(state: RuntimeMultiAgentState): MultiAgentState {
  return {
    auth: state.auth,
    runId: state.runId,
    activeStepId: state.activeStepId,
    tenantId: state.tenantId,
    sessionId: state.sessionId,
    messages: structuredClone(state.messages),
    events: structuredClone(state.events ?? []),
    latestUserTask: state.latestUserTask,
    taskKind: state.taskKind,
    plan: structuredClone(state.plan),
    activeAgent: state.activeAgent,
    observations: structuredClone(state.observations),
    traceGroupId: state.traceGroupId,
    subtaskResults: structuredClone(state.subtaskResults),
    executorResult: state.executorResult,
    reviewerResult: structuredClone(state.reviewerResult),
    reviewerFeedback: state.reviewerFeedback,
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
    requirePlanApproval: state.requirePlanApproval,
    planApproved: state.planApproved,
    finalAnswer: state.finalAnswer,
    completionReason: state.completionReason,
  };
}

function requireStateTenantId(state: { tenantId: string | null }) {
  if (!state.tenantId) {
    throw new Error("tenantId is required on multi-agent state");
  }

  return state.tenantId;
}

function appendObservation(
  state: MultiAgentState,
  observation: Omit<AgentObservation, "id" | "createdAt">
) {
  const nextObservation: AgentObservation = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...observation,
  };

  state.observations.push(nextObservation);
  state.events.push({
    type: "agent_status",
    agentName: observation.agent,
    phase: observation.phase,
    message: observation.message,
    latencyMs: observation.latencyMs,
    toolCount: observation.toolCount,
  });

  if (state.sessionId) {
    void appendAgentTrace(
      state.sessionId,
      state.traceGroupId,
      state.taskKind,
      nextObservation
    ).catch((error) => {
      console.error("Failed to persist agent trace", error);
    });
  }
}

function stripCodeFenceJson(content: string) {
  const trimmed = content.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function withObservedNode<T>(
  state: MultiAgentState,
  options: {
    agentName: AgentRole;
    nodeName: string;
    stepType?: "workflow" | "agent_node" | "interrupt";
    input?: unknown;
    output?: (value: T) => unknown;
  },
  action: () => Promise<T>
) {
  const stepId = state.runId
    ? await createAgentStep({
        runId: state.runId,
        tenantId: state.tenantId,
        sessionId: state.sessionId,
        agentName: options.agentName,
        nodeName: options.nodeName,
        stepType: options.stepType ?? "agent_node",
        input: options.input,
      })
    : null;

  try {
    state.activeStepId = stepId;
    const result = await action();
    if (stepId) {
      await completeAgentStep({
        stepId,
        tenantId: requireStateTenantId(state),
        sessionId: state.sessionId,
        runId: state.runId,
        output: options.output ? options.output(result) : null,
      });
    }
    state.activeStepId = null;
    return result;
  } catch (error) {
    state.activeStepId = null;
    if (stepId) {
      await completeAgentStep({
        stepId,
        tenantId: requireStateTenantId(state),
        sessionId: state.sessionId,
        runId: state.runId,
        status: "error",
        output: {
          nodeName: options.nodeName,
        },
      });
    }
    if (state.runId) {
      await appendErrorLog({
        runId: state.runId,
        tenantId: state.tenantId,
        stepId,
        sessionId: state.sessionId,
        source: options.nodeName,
        error,
        context: options.input,
      });
    }
    throw error;
  }
}

async function collectModelText(
  messages: ProviderMessage[],
  trace?: {
    runId?: string | null;
    stepId?: string | null;
    sessionId?: string | null;
    agentName?: AgentRole | null;
    nodeName?: string | null;
    input?: unknown;
  }
) {
  const provider = getDefaultChatProvider();
  const startedAt = Date.now();
  const promptTokenEstimate = estimateTokenCount(messages);
  try {
    const stream = await provider.createChatStream(messages);

    for await (const ignoredEvent of stream.events) {
      void ignoredEvent;
      // Planner / reviewer only need the final accumulated assistant message.
    }

    const assistantMessage = stream.getAssistantMessage();
    const content =
      assistantMessage && typeof assistantMessage.content === "string"
        ? assistantMessage.content
        : "";

    if (trace?.runId) {
      await appendModelCall({
        runId: trace.runId,
        stepId: trace.stepId ?? null,
        sessionId: trace.sessionId ?? null,
        agentName: trace.agentName ?? null,
        nodeName: trace.nodeName ?? "collectModelText",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        completionTokens: estimateTokenCount(content),
        reasoningTokens: estimateTokenCount(
          assistantMessage?.reasoning_content ?? ""
        ),
        latencyMs: Date.now() - startedAt,
        status: "success",
        input: trace.input ?? {
          messageCount: messages.length,
        },
        output: {
          content,
        },
      });
    }

    return {
      assistantMessage,
      content,
    };
  } catch (error) {
    if (trace?.runId) {
      await appendModelCall({
        runId: trace.runId,
        stepId: trace.stepId ?? null,
        sessionId: trace.sessionId ?? null,
        agentName: trace.agentName ?? null,
        nodeName: trace.nodeName ?? "collectModelText",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        latencyMs: Date.now() - startedAt,
        status: "error",
        input: trace.input ?? {
          messageCount: messages.length,
        },
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
    throw error;
  }
}

async function collectModelTextWithTools(
  messages: ProviderMessage[],
  tools: ProviderToolDefinition[],
  trace?: {
    runId?: string | null;
    stepId?: string | null;
    sessionId?: string | null;
    agentName?: AgentRole | null;
    nodeName?: string | null;
    input?: unknown;
    onTextDelta?: (text: string) => void;
  }
) {
  const provider = getDefaultChatProvider();
  const startedAt = Date.now();
  const promptTokenEstimate = estimateTokenCount(messages);
  try {
    const stream = await provider.createChatStream(messages, {
      tools,
    });
    const toolCalls: ProviderToolCall[] = [];

    for await (const event of stream.events) {
      if (event.type === "text_delta") {
        trace?.onTextDelta?.(event.text);
        continue;
      }

      if (event.type === "tool_call_delta") {
        collectToolCall(toolCalls, event.toolCall);
      }
    }

    const assistantMessage = stream.getAssistantMessage();
    if (trace?.runId) {
      await appendModelCall({
        runId: trace.runId,
        stepId: trace.stepId ?? null,
        sessionId: trace.sessionId ?? null,
        agentName: trace.agentName ?? null,
        nodeName: trace.nodeName ?? "collectModelTextWithTools",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        completionTokens: estimateTokenCount(assistantMessage?.content ?? ""),
        reasoningTokens: estimateTokenCount(
          assistantMessage?.reasoning_content ?? ""
        ),
        latencyMs: Date.now() - startedAt,
        status: "success",
        input: trace.input ?? {
          messageCount: messages.length,
          toolCount: tools.length,
        },
        output: {
          toolCallCount: toolCalls.length,
        },
      });
    }

    return {
      assistantMessage,
      toolCalls,
    };
  } catch (error) {
    if (trace?.runId) {
      await appendModelCall({
        runId: trace.runId,
        stepId: trace.stepId ?? null,
        sessionId: trace.sessionId ?? null,
        agentName: trace.agentName ?? null,
        nodeName: trace.nodeName ?? "collectModelTextWithTools",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        latencyMs: Date.now() - startedAt,
        status: "error",
        input: trace.input ?? {
          messageCount: messages.length,
          toolCount: tools.length,
        },
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
    throw error;
  }
}

async function planTaskWithModel(task: string, state?: MultiAgentState) {
  const plannerMessages: ProviderMessage[] = [
    {
      role: "system",
      content: createPlannerPrompt(task),
    },
    {
      role: "user",
      content: task,
    },
  ];

  const { content } = await collectModelText(plannerMessages, {
    runId: state?.runId,
    stepId: state?.activeStepId,
    sessionId: state?.sessionId,
    agentName: "planner",
    nodeName: "planner:model",
    input: {
      task,
    },
  });

  try {
    const parsed = JSON.parse(stripCodeFenceJson(content)) as unknown;
    if (isPlannerOutput(parsed)) {
      const taskKind = classifyTaskKind(task);
      return {
        ...parsed,
        primaryAgent: getPrimaryExecutionAgent(taskKind),
        requiresPlanApproval: shouldRequirePlanApproval(task, taskKind),
      };
    }
  } catch {
    // Fall back to deterministic planning when the model does not return valid JSON.
  }

  return createFallbackPlan(task);
}

async function executeAgentTask(
  state: MultiAgentState,
  role: Extract<AgentRole, "code" | "browser" | "tool_executor">,
  systemPrompt: string,
  baseMessages: ProviderMessage[]
) {
  const allProviderTools = await getProviderTools();
  const allowTool = filterToolNamesForAgent(role);
  const providerTools = allProviderTools.filter((tool) => {
    const name =
      typeof tool?.function === "object" &&
      tool.function &&
      "name" in tool.function
        ? (tool.function.name as string)
        : "";
    return allowTool(name);
  }) as ProviderToolDefinition[];

  const localEvents: StreamEvent[] = [];
  const executionMessages: ProviderMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...structuredClone(baseMessages),
  ];
  let latestAssistantMessage: ProviderMessage | null = null;
  let totalToolCount = 0;

  for (let step = 0; step < 4; step += 1) {
    const { assistantMessage, toolCalls } = await collectModelTextWithTools(
      executionMessages,
      providerTools,
      {
        runId: state.runId,
        stepId: state.activeStepId,
        sessionId: state.sessionId,
        agentName: role,
        nodeName: `${role}:model_with_tools`,
        input: {
          messageCount: executionMessages.length,
          toolCount: providerTools.length,
        },
        onTextDelta: (text) => {
          emitLiveRunEvent(state.runId, {
            type: "agent_delta",
            agentName: role,
            text,
          });
        },
      }
    );

    latestAssistantMessage = assistantMessage;

    if (assistantMessage) {
      executionMessages.push(assistantMessage);
    }

    if (toolCalls.length === 0) {
      break;
    }

    totalToolCount += toolCalls.length;

    for (const toolCall of toolCalls) {
      if (
        toolCall.id &&
        executionMessages.some(
          (message) =>
            message?.role === "tool" && message?.tool_call_id === toolCall.id
        )
      ) {
        continue;
      }

      await executeSingleToolCall(
        {
          auth: state.auth,
          runId: state.runId,
          activeStepId: state.activeStepId,
          tenantId: state.tenantId,
          sessionId: state.sessionId,
          messages: executionMessages,
          step,
          maxSteps: 4,
          toolCalls,
          assistantContent: "",
          reasoningContent: "",
          events: localEvents,
          assistantMessage,
          currentNode: "tools",
          lastNode: "tools",
          completionReason: null,
        },
        toolCall,
        parseToolCallArgs(toolCall)
      );
    }
  }

  let content =
    latestAssistantMessage && typeof latestAssistantMessage.content === "string"
      ? latestAssistantMessage.content.trim()
      : "";

  if (!content) {
    const synthesisMessages: ProviderMessage[] = [
      {
        role: "system",
        content:
          "Summarize the gathered findings into a concise answer for this specific subtask. Do not call tools.",
      },
      ...executionMessages.slice(1),
    ];
    const synthesis = await collectModelText(synthesisMessages, {
      runId: state.runId,
      stepId: state.activeStepId,
      sessionId: state.sessionId,
      agentName: role,
      nodeName: `${role}:subtask_synthesis`,
      input: {
        messageCount: synthesisMessages.length,
      },
    });
    content = synthesis.content.trim();
  }

  return {
    content,
    events: localEvents,
    toolCount: totalToolCount,
    messages: executionMessages.slice(1),
  };
}

async function runParallelSubtasks(
  state: MultiAgentState,
  plan: PlannerOutput
) {
  const subtaskSteps = plan.steps
    .filter((step) => step.agent !== "reviewer")
    .slice(0, 3)
    .map((step) => ({
      id: step.id,
      title: step.title,
      objective: step.objective,
      agent: step.agent as Extract<AgentRole, "code" | "browser" | "tool_executor">,
    }));

  if (subtaskSteps.length < 2) {
    return null;
  }

  const baseMessages = structuredClone(state.messages);

  const results = await Promise.all(
    subtaskSteps.map(async (step) => {
      appendObservation(state, {
        agent: step.agent,
        phase: "started",
        message: `Starting subtask: ${step.title}`,
      });

      const startedAt = Date.now();
      const output = await executeAgentTask(
        state,
        step.agent,
        createSubtaskPrompt(step.agent, step, plan),
        baseMessages
      );

      state.events.push(...output.events);

      appendObservation(state, {
        agent: step.agent,
        phase: "completed",
        message: `Completed subtask: ${step.title}`,
        latencyMs: Date.now() - startedAt,
        toolCount: output.toolCount,
      });

      return {
        id: step.id,
        agent: step.agent,
        title: step.title,
        objective: step.objective,
        result: output.content,
        toolCount: output.toolCount,
      } satisfies SubtaskResult;
    })
  );

  state.subtaskResults = results;
  return results;
}

async function runExecutorLoop(
  state: MultiAgentState,
  role: Extract<AgentRole, "code" | "browser" | "tool_executor">
) {
  if (!state.plan) {
    throw new Error("Executor cannot run without a plan");
  }

  const startedAt = Date.now();
  appendObservation(state, {
    agent: role,
    phase: "started",
    message: `Executing task with ${role} agent`,
  });

  const parallelResults = await runParallelSubtasks(state, state.plan);

  if (parallelResults && parallelResults.length > 0) {
    const synthesis = await collectModelText([
      {
        role: "system",
        content: createSynthesisPrompt(
          state.plan,
          parallelResults,
          state.reviewerFeedback
        ),
      },
      ...structuredClone(state.messages),
    ], {
      runId: state.runId,
      stepId: state.activeStepId,
      sessionId: state.sessionId,
      agentName: role,
      nodeName: `${role}:parallel_synthesis`,
      input: {
        subtaskCount: parallelResults.length,
      },
    });
    state.executorResult = synthesis.content.trim();
  } else {
    const output = await executeAgentTask(
      state,
      role,
      createExecutorPrompt(role, state.plan, state.reviewerFeedback),
      state.messages
    );
    state.events.push(...output.events);
    state.executorResult = output.content.trim();
    state.subtaskResults = [
      {
        id: "primary-execution",
        agent: role,
        title: "Primary execution",
        objective: state.plan.goal,
        result: output.content.trim(),
        toolCount: output.toolCount,
      },
    ];
  }

  state.activeAgent = role;

  appendObservation(state, {
    agent: role,
    phase: "completed",
    message: state.executorResult || `${role} agent completed execution`,
    latencyMs: Date.now() - startedAt,
    toolCount: state.subtaskResults.reduce(
      (count, item) => count + item.toolCount,
      0
    ),
  });
}

async function reviewExecutorResult(state: MultiAgentState) {
  if (!state.plan) {
    throw new Error("Reviewer cannot run without a plan");
  }

  const startedAt = Date.now();
  appendObservation(state, {
    agent: "reviewer",
    phase: "started",
    message: "Reviewing executor output",
  });

  const reviewerMessages: ProviderMessage[] = [
    {
      role: "system",
      content: createReviewerPrompt(state.plan, state.executorResult),
    },
    {
      role: "user",
      content: state.latestUserTask,
    },
  ];

  const { content } = await collectModelText(reviewerMessages, {
    runId: state.runId,
    stepId: state.activeStepId,
    sessionId: state.sessionId,
    agentName: "reviewer",
    nodeName: "reviewer:model",
    input: {
      planGoal: state.plan.goal,
    },
  });
  let review: ReviewerOutput;

  try {
    const parsed = JSON.parse(stripCodeFenceJson(content)) as unknown;
    if (isReviewerOutput(parsed)) {
      review = parsed;
    } else {
      throw new Error("Invalid reviewer JSON");
    }
  } catch {
    review = {
      approved: true,
      feedback: "",
      finalAnswer: state.executorResult,
    };
  }

  state.reviewerResult = review;
  state.reviewerFeedback = review.feedback;

  appendObservation(state, {
    agent: "reviewer",
    phase: review.approved ? "completed" : "handoff",
    message: review.approved
      ? "Reviewer approved the execution result"
      : review.feedback || "Reviewer requested another pass",
    latencyMs: Date.now() - startedAt,
  });
}

async function streamFinalAnswer(state: MultiAgentState) {
  if (!state.plan) {
    return {
      finalAnswer: state.executorResult.trim() || "任务已完成。",
      streamed: false,
    };
  }

  const provider = getDefaultChatProvider();
  const promptTokenEstimate = estimateTokenCount([
    state.plan.goal,
    state.latestUserTask,
    state.executorResult,
    state.reviewerResult?.finalAnswer ?? "",
    state.reviewerFeedback,
  ]);
  const startedAt = Date.now();
  const finalizerMessages: ProviderMessage[] = [
    {
      role: "system",
      content: createFinalizerPrompt({
        goal: state.plan.goal,
        latestUserTask: state.latestUserTask,
        executorResult: state.executorResult,
        reviewerAnswer: state.reviewerResult?.finalAnswer,
        reviewerFeedback: state.reviewerFeedback,
      }),
    },
    {
      role: "user",
      content: state.latestUserTask,
    },
  ];

  try {
    const stream = await provider.createChatStream(finalizerMessages);
    let streamedAnswer = "";
    let streamed = false;

    for await (const event of stream.events) {
      if (event.type !== "text_delta") {
        continue;
      }

      streamedAnswer += event.text;
      streamed = true;
      emitLiveRunEvent(state.runId, {
        type: "text",
        content: event.text,
      });
    }

    const assistantMessage = stream.getAssistantMessage();
    const finalAnswer =
      (assistantMessage &&
      typeof assistantMessage.content === "string" &&
      assistantMessage.content.trim()) ||
      streamedAnswer.trim() ||
      state.reviewerResult?.finalAnswer?.trim() ||
      state.executorResult.trim() ||
      "任务已完成。";

    if (state.runId) {
      await appendModelCall({
        runId: state.runId,
        stepId: state.activeStepId,
        sessionId: state.sessionId,
        agentName: "finalizer",
        nodeName: "finalizer:model",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        completionTokens: estimateTokenCount(finalAnswer),
        reasoningTokens: estimateTokenCount(
          assistantMessage?.reasoning_content ?? ""
        ),
        latencyMs: Date.now() - startedAt,
        status: "success",
        input: {
          latestUserTask: state.latestUserTask,
          planGoal: state.plan.goal,
        },
        output: {
          finalAnswer,
        },
      });
    }

    return {
      finalAnswer,
      streamed,
    };
  } catch (error) {
    if (state.runId) {
      await appendModelCall({
        runId: state.runId,
        stepId: state.activeStepId,
        sessionId: state.sessionId,
        agentName: "finalizer",
        nodeName: "finalizer:model",
        provider: provider.providerName ?? "unknown",
        model: provider.modelName ?? "unknown",
        promptTokens: promptTokenEstimate,
        latencyMs: Date.now() - startedAt,
        status: "error",
        input: {
          latestUserTask: state.latestUserTask,
          planGoal: state.plan.goal,
        },
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return {
      finalAnswer:
        state.reviewerResult?.finalAnswer?.trim() ||
        state.executorResult.trim() ||
        "任务已完成。",
      streamed: false,
    };
  }
}

async function plannerNode(state: RuntimeMultiAgentState) {
  const nextState = cloneState(state);
  return withObservedNode(
    nextState,
    {
      agentName: "planner",
      nodeName: "planner",
      stepType: "workflow",
      input: {
        latestUserTask: nextState.latestUserTask,
      },
      output: (result) => ({
        planSummary: result.plan ? createPlanSummary(result.plan) : null,
        completionReason: result.completionReason,
      }),
    },
    async () => {
      const startedAt = Date.now();

      appendObservation(nextState, {
        agent: "planner",
        phase: "started",
        message: "Planning the task and selecting an execution agent",
      });

      const plan = await planTaskWithModel(nextState.latestUserTask, nextState);
      nextState.plan = plan;
      nextState.activeAgent = "planner";
      nextState.requirePlanApproval = plan.requiresPlanApproval;

      appendObservation(nextState, {
        agent: "planner",
        phase: "completed",
        message: createPlanSummary(plan),
        latencyMs: Date.now() - startedAt,
      });

      if (nextState.requirePlanApproval && nextState.planApproved === null) {
        if (!nextState.runId || !nextState.sessionId) {
          throw new Error(
            "Cannot request plan confirmation without runId and sessionId."
          );
        }

        const planSummary = createPlanSummary(plan);
        const pendingApproval = await appendInterruptEvent({
          runId: nextState.runId,
          tenantId: nextState.tenantId,
          sessionId: nextState.sessionId,
          kind: "plan_confirmation",
          status: "pending",
          message: "是否批准这个执行计划？",
          payload: buildApprovalPayload({
            toolCallId: `plan-${nextState.sessionId}`,
            toolName: "planner_plan",
            planSummary,
            riskLevel: "confirm_required",
            permissions: ["execute"],
          }),
        });

        const resume = interrupt<
          {
            kind: "plan_confirmation";
            approvalId: string;
            planSummary: string;
          },
          MultiAgentResume
        >({
          kind: "plan_confirmation",
          approvalId: pendingApproval.id,
          planSummary,
        });

        if (!resume?.approved) {
          nextState.planApproved = false;
          nextState.finalAnswer =
            resume?.reason?.trim() || "Execution plan was rejected by the user.";
          nextState.completionReason = "plan_rejected";
          return nextState;
        }

        nextState.planApproved = true;
      }

      return nextState;
    }
  );
}

async function executorNode(state: RuntimeMultiAgentState) {
  const nextState = cloneState(state);
  const agent = nextState.plan
    ? nextState.plan.primaryAgent
    : getPrimaryExecutionAgent(nextState.taskKind);
  return withObservedNode(
    nextState,
    {
      agentName: agent,
      nodeName: "executor",
      stepType: "workflow",
      input: {
        planGoal: nextState.plan?.goal ?? null,
        reviewerFeedback: nextState.reviewerFeedback,
      },
      output: (result) => ({
        executorResult: result.executorResult,
        subtaskCount: result.subtaskResults.length,
      }),
    },
    async () => {
      await runExecutorLoop(nextState, agent);
      return nextState;
    }
  );
}

async function reviewerNode(state: RuntimeMultiAgentState) {
  const nextState = cloneState(state);
  return withObservedNode(
    nextState,
    {
      agentName: "reviewer",
      nodeName: "reviewer",
      stepType: "workflow",
      input: {
        executorResult: nextState.executorResult,
      },
      output: (result) => result.reviewerResult,
    },
    async () => {
      await reviewExecutorResult(nextState);
      if (nextState.reviewerResult && !nextState.reviewerResult.approved) {
        nextState.revisionCount += 1;
      }
      return nextState;
    }
  );
}

async function finalizerNode(state: RuntimeMultiAgentState) {
  const nextState = cloneState(state);
  return withObservedNode(
    nextState,
    {
      agentName: "finalizer",
      nodeName: "finalizer",
      stepType: "workflow",
      input: {
        completionReason: nextState.completionReason,
      },
      output: (result) => ({
        finalAnswer: result.finalAnswer,
      }),
    },
    async () => {
      nextState.activeAgent = "finalizer";

      const finalResult =
        nextState.completionReason === "plan_rejected"
          ? {
              finalAnswer: nextState.finalAnswer,
              streamed: false,
            }
          : await streamFinalAnswer(nextState);
      const finalAnswer = finalResult.finalAnswer;

      nextState.finalAnswer = finalAnswer;
      nextState.completionReason = nextState.completionReason ?? "completed";
      const lastAssistant = [...nextState.messages]
        .reverse()
        .find(
          (message) =>
            message?.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.trim() !== ""
        );

      if (
        !lastAssistant ||
        typeof lastAssistant.content !== "string" ||
        lastAssistant.content.trim() !== finalAnswer
      ) {
        nextState.messages.push({
          role: "assistant",
          content: finalAnswer,
        });
      }

      if (nextState.completionReason === "plan_rejected" || !finalResult.streamed) {
        nextState.events.push({
          type: "text",
          content: finalAnswer,
        });
      }

      appendObservation(nextState, {
        agent: "finalizer",
        phase: "completed",
        message: "Prepared final user-facing answer",
      });

      return nextState;
    }
  );
}

function routeAfterPlanner(state: RuntimeMultiAgentState) {
  return state.completionReason === "plan_rejected" ? "finalizer" : "executor";
}

function routeAfterReviewer(state: RuntimeMultiAgentState) {
  if (
    state.reviewerResult &&
    !state.reviewerResult.approved &&
    state.revisionCount <= state.maxRevisionCount
  ) {
    return "executor";
  }

  return "finalizer";
}

export const multiAgentGraph = new StateGraph(MultiAgentGraphState)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("reviewer", reviewerNode)
  .addNode("finalizer", finalizerNode)
  .addEdge(START, "planner")
  .addConditionalEdges("planner", routeAfterPlanner, {
    executor: "executor",
    finalizer: "finalizer",
  })
  .addEdge("executor", "reviewer")
  .addConditionalEdges("reviewer", routeAfterReviewer, {
    executor: "executor",
    finalizer: "finalizer",
  })
  .addEdge("finalizer", END)
  .compile({
    checkpointer: multiAgentMemorySaver,
  });

function createMultiAgentThreadId(threadId: string) {
  return `${threadId}:multi-agent`;
}

function enqueueEvents(
  controller: ReadableStreamDefaultController<Uint8Array>,
  events: StreamEvent[]
) {
  for (const event of events) {
    controller.enqueue(encodeSSE(event));
  }
}

function getSafeMessages(
  messages: ProviderMessage[] | undefined,
  fallbackMessages: ProviderMessage[]
) {
  return Array.isArray(messages) ? messages : fallbackMessages;
}

async function persistMultiAgentThreadState(
  threadId: string,
  options: { tenantId: string }
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to persist multi-agent thread state");
  }

  const scopedThreadId = createMultiAgentThreadId(threadId);
  const snapshot = await multiAgentGraph.getState({
    configurable: {
      thread_id: scopedThreadId,
    },
  });
  const values =
    snapshot.values && typeof snapshot.values === "object"
      ? snapshot.values
      : null;

  if (!values) {
    return null;
  }

  await upsertTenantCheckpoint({
    tenantId: options.tenantId,
    sessionId: threadId,
    threadId: scopedThreadId,
    payload: values,
  });

  return values;
}

async function streamMultiAgentInput(
  input: MultiAgentState | MultiAgentResumeCommand,
  options: {
    auth: AuthContext;
    threadId: string;
    tenantId: string;
    onFinish?: (messages: ProviderMessage[]) => void;
    runId?: string;
  }
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to run multi-agent runtime");
  }

  const scopedThreadId = createMultiAgentThreadId(options.threadId);
  const initialMessages = "messages" in input ? input.messages : [];

  return new ReadableStream({
    async start(controller) {
      let latestState =
        "messages" in input
          ? input
          : createMultiAgentState(
              [],
              options.threadId,
              false,
              options.runId ?? null,
              options.tenantId,
              options.auth
            );

      try {
        if (options.runId) {
          registerLiveRunEmitter(options.runId, (event) => {
            controller.enqueue(encodeSSE(event));
          });
          controller.enqueue(
            encodeSSE({
              type: "run_started",
              runId: options.runId,
              runtimeType: "multi_agent",
            })
          );
        }
        const stream = await multiAgentGraph.stream(input, {
          streamMode: "values",
          configurable: {
            thread_id: scopedThreadId,
          },
        });

        for await (const chunk of stream as AsyncIterable<RuntimeMultiAgentState>) {
          if (isInterrupted(chunk)) {
            const interruptPayload = chunk[INTERRUPT][0]?.value as
              | {
                  kind?: string;
                  planSummary?: string;
                  approvalId?: string;
                }
              | undefined;

            if (interruptPayload?.kind === "plan_confirmation") {
              let approvalId =
                typeof interruptPayload.approvalId === "string"
                  ? interruptPayload.approvalId
                  : undefined;

              if (!approvalId && latestState.runId) {
                const pendingApproval = await appendInterruptEvent({
                  runId: latestState.runId,
                  tenantId: options.tenantId,
                  sessionId: options.threadId,
                  kind: "plan_confirmation",
                  status: "pending",
                  message: "是否批准这个执行计划？",
                  payload: buildApprovalPayload({
                    toolCallId: `plan-${options.threadId}`,
                    toolName: "planner_plan",
                    planSummary: interruptPayload.planSummary ?? "",
                    riskLevel: "confirm_required",
                    permissions: ["execute"],
                  }),
                });
                approvalId = pendingApproval.id;
              }

              if (!approvalId) {
                throw new Error(
                  "Plan confirmation is missing a server approvalId."
                );
              }

              controller.enqueue(
                encodeSSE({
                  type: "confirm_request",
                  approvalId,
                  toolName: "planner_plan",
                  toolCallId: `plan-${options.threadId}`,
                  args: {
                    planSummary: interruptPayload.planSummary ?? "",
                  },
                  message: "是否批准这个执行计划？",
                  toolSummary: interruptPayload.planSummary ?? "",
                  toolRiskLevel: "confirm_required",
                  toolPermissions: ["execute"],
                })
              );
            }

            latestState = {
              ...cloneState(chunk),
              auth: options.auth,
              tenantId: options.tenantId,
              sessionId: options.threadId,
            };
            await persistMultiAgentThreadState(options.threadId, {
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
            options.onFinish?.(
              structuredClone(getSafeMessages(latestState.messages, initialMessages))
            );
            if (options.runId) {
              unregisterLiveRunEmitter(options.runId);
            }
            controller.close();
            return;
          }

          latestState = {
            ...cloneState(chunk),
            auth: options.auth,
            tenantId: options.tenantId,
            sessionId: options.threadId,
          };
          if (chunk.events?.length) {
            enqueueEvents(controller, chunk.events);
          }
        }

        await persistMultiAgentThreadState(options.threadId, {
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
        options.onFinish?.(
          structuredClone(getSafeMessages(latestState.messages, initialMessages))
        );
        if (options.runId) {
          unregisterLiveRunEmitter(options.runId);
        }
        controller.close();
      } catch (error) {
        console.error(error);
        controller.enqueue(
          encodeSSE({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          })
        );
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
            source: "multi_agent_runtime",
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
            errorMessage: error instanceof Error ? error.message : "Unknown error",
          });
        }
        options.onFinish?.(
          structuredClone(
            getSafeMessages(latestState.messages, initialMessages).length
              ? getSafeMessages(latestState.messages, initialMessages)
              : initialMessages
          )
        );
        if (options.runId) {
          unregisterLiveRunEmitter(options.runId);
        }
        controller.close();
      }
    },
  });
}

export async function runMultiAgentRuntime(
  messages: ProviderMessage[],
  options: {
    auth: AuthContext;
    threadId: string;
    tenantId: string;
    requirePlanApproval?: boolean;
    onFinish?: (messages: ProviderMessage[]) => void;
    runId?: string;
  }
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to run multi-agent runtime");
  }

  await requireSessionInTenant(options.tenantId, options.threadId);
  await ensureSession(options.threadId, {
    tenantId: options.tenantId,
  });

  return streamMultiAgentInput(
    createMultiAgentState(
      structuredClone(messages),
      options.threadId,
      options.requirePlanApproval ?? false,
      options.runId ?? null,
      options.tenantId,
      options.auth
    ),
    {
      auth: options.auth,
      threadId: options.threadId,
      tenantId: options.tenantId,
      onFinish: options.onFinish,
      runId: options.runId,
    }
  );
}

export async function resumeMultiAgentRuntime(
  resume: MultiAgentResume,
  options: {
    auth: AuthContext;
    threadId: string;
    tenantId: string;
    onFinish?: (messages: ProviderMessage[]) => void;
    runId?: string;
  }
) {
  if (!options.tenantId) {
    throw new Error("tenantId is required to resume multi-agent runtime");
  }

  await requireSessionInTenant(options.tenantId, options.threadId);

  return streamMultiAgentInput(
    new Command({
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
