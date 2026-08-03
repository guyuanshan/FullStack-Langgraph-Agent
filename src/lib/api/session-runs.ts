import "server-only";

import { runAgentRuntime } from "../agent/runtime";
import {
  resumeLangGraphRuntime,
  runLangGraphRuntime,
} from "../agent/langgraphRuntime";
import {
  resumeMultiAgentRuntime,
  runMultiAgentRuntime,
} from "../multi-agent/runtime";
import {
  getPersistedRuntimeThreadState,
  getRuntimeThreadState,
} from "../graph";
import {
  buildAgentContext,
  getFullSessionMessages,
  isEphemeralContextMessage,
  maybeSummarizeSession,
  setSessionMessages,
  type SessionMessage,
} from "../chat";
import { createAgentRun } from "../observability/store";
import type { AuthContext } from "../auth/context";
import {
  assertCanStartAgentRun,
  ensureTenantSession,
  requireTenantSession,
} from "../db/tenant-access";
import type { ResumeRunBody, StartRunBody } from "./schemas";
import { ApiValidationError } from "./validate";
import { authorizeAndConsumePendingApproval } from "./pending-approvals";

function stripEphemeralSystemMessages(messages: SessionMessage[] | undefined) {
  return (messages ?? []).filter(
    (message) => !isEphemeralContextMessage(message)
  );
}

function toUiMessages(messages: SessionMessage[]) {
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }

    const role = message.role;
    const content = message.content;

    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim() !== ""
    ) {
      return [
        {
          role,
          content,
        },
      ];
    }

    return [];
  });
}

async function getCheckpointMessages(sessionId: string, tenantId: string) {
  let values: Record<string, unknown> | null = null;

  try {
    const snapshot = await getRuntimeThreadState(sessionId);
    values =
      snapshot.values && typeof snapshot.values === "object"
        ? (snapshot.values as Record<string, unknown>)
        : null;
  } catch {
    const persisted = await getPersistedRuntimeThreadState(sessionId, {
      tenantId,
    });
    values =
      persisted && typeof persisted === "object"
        ? (persisted as Record<string, unknown>)
        : null;
  }

  const messages = values?.messages;

  if (!Array.isArray(messages)) {
    return [];
  }

  return toUiMessages(messages as SessionMessage[]);
}

function persistSessionMessages(auth: AuthContext, sessionId: string) {
  return (nextMessages: SessionMessage[]) => {
    void (async () => {
      await setSessionMessages(
        sessionId,
        stripEphemeralSystemMessages(nextMessages),
        { tenantId: auth.tenantId }
      );
      await maybeSummarizeSession(sessionId, { tenantId: auth.tenantId });
    })();
  };
}

function streamResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function loadSessionMessages(
  auth: AuthContext,
  sessionId: string,
  options: { useLangGraph?: boolean } = {}
) {
  await requireTenantSession(auth, sessionId);

  const storedMessages = toUiMessages(
    await getFullSessionMessages(sessionId, { tenantId: auth.tenantId })
  );
  let messages = storedMessages;

  if (messages.length === 0 && options.useLangGraph) {
    try {
      messages = await getCheckpointMessages(sessionId, auth.tenantId);
    } catch (error) {
      console.error(error);
    }
  }

  return {
    sessionId,
    messages,
  };
}

export async function startSessionRun(
  auth: AuthContext,
  sessionId: string,
  body: StartRunBody,
  options: { entrypoint?: string } = {}
) {
  assertCanStartAgentRun(auth);

  const latestUserMessage = body.messages.at(-1);

  if (!latestUserMessage) {
    throw new ApiValidationError(400, "Missing latest user message.");
  }

  // Validate + authorize before creating any run row.
  await ensureTenantSession(auth, sessionId);

  const runId = crypto.randomUUID();
  await createAgentRun({
    runId,
    tenantId: auth.tenantId,
    sessionId,
    runtimeType: body.useMultiAgent
      ? "multi_agent"
      : body.useLangGraph
        ? "langgraph"
        : "manual",
    trigger: "request",
    entrypoint: options.entrypoint ?? "/api/sessions/:sessionId/runs",
    latestUserTask: latestUserMessage.content,
  });

  const sessionMessages = await buildAgentContext(
    auth,
    sessionId,
    latestUserMessage.content
  );
  sessionMessages.push({
    role: "user",
    content: latestUserMessage.content,
  });

  const onFinish = persistSessionMessages(auth, sessionId);

  const stream = body.useMultiAgent
    ? await runMultiAgentRuntime(sessionMessages, {
        auth,
        threadId: sessionId,
        tenantId: auth.tenantId,
        requirePlanApproval: true,
        runId,
        onFinish,
      })
    : body.useLangGraph
      ? await runLangGraphRuntime(sessionMessages, {
          auth,
          threadId: sessionId,
          tenantId: auth.tenantId,
          runId,
          onFinish,
        })
      : await runAgentRuntime(sessionMessages, {
          auth,
          sessionId,
          tenantId: auth.tenantId,
          runId,
          onFinish,
        });

  return streamResponse(stream);
}

export async function resumeSessionRun(
  auth: AuthContext,
  body: Pick<ResumeRunBody, "approvalId" | "confirmation">,
  options: {
    entrypoint?: string;
    expectedSessionId?: string;
  } = {}
) {
  assertCanStartAgentRun(auth);

  // 1) load pending + server risk/runtime
  // 2) authorize role against server risk
  // 3) atomically consume only after authorization
  const approval = await authorizeAndConsumePendingApproval({
    auth,
    approvalId: body.approvalId,
    decision: body.confirmation.decision,
    reason: body.confirmation.reason,
    expectedSessionId: options.expectedSessionId,
  });

  if (
    approval.runtimeType !== "langgraph" &&
    approval.runtimeType !== "multi_agent"
  ) {
    throw new ApiValidationError(
      400,
      "Pending approval is not bound to a resumable runtime."
    );
  }

  const sessionId = approval.sessionId;
  await ensureTenantSession(auth, sessionId);

  const runId = crypto.randomUUID();
  await createAgentRun({
    runId,
    tenantId: auth.tenantId,
    sessionId,
    runtimeType: approval.runtimeType,
    trigger: "resume",
    entrypoint: options.entrypoint ?? "/api/sessions/:sessionId/runs",
    latestUserTask: null,
  });

  const resumePayload = {
    approved: body.confirmation.decision === "approved",
    reason:
      body.confirmation.reason && body.confirmation.reason.trim() !== ""
        ? body.confirmation.reason
        : body.confirmation.decision === "rejected"
          ? "User rejected execution"
          : undefined,
  };

  const onFinish = persistSessionMessages(auth, sessionId);

  const stream =
    approval.runtimeType === "multi_agent"
      ? await resumeMultiAgentRuntime(resumePayload, {
          auth,
          threadId: sessionId,
          tenantId: auth.tenantId,
          runId,
          onFinish,
        })
      : await resumeLangGraphRuntime(resumePayload, {
          auth,
          threadId: sessionId,
          tenantId: auth.tenantId,
          runId,
          onFinish,
        });

  return streamResponse(stream);
}
