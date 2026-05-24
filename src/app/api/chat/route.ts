import { runAgentRuntime } from "../../../lib/agent/runtime";
import {
  resumeLangGraphRuntime,
  runLangGraphRuntime,
} from "../../../lib/agent/langgraphRuntime";
import {
  resumeMultiAgentRuntime,
  runMultiAgentRuntime,
} from "../../../lib/multi-agent/runtime";
import {
  getPersistedRuntimeThreadState,
  getRuntimeThreadState,
} from "../../../lib/graph";
import {
  buildAgentContext,
  deleteSession,
  ensureSession,
  getFullSessionMessages,
  isEphemeralContextMessage,
  listSessions,
  maybeSummarizeSession,
  setSessionMessages,
  type SessionMessage,
} from "../../../lib/chat";
import {
  applyPatchProposal,
  rejectPatchProposal,
} from "../../../lib/code-agent/proposals";
import { createAgentRun } from "../../../lib/observability/store";
import {
  getRunTrace,
  listSessionRuns,
} from "../../../lib/observability/queries";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type ConfirmationRequest = {
  decision: "approved" | "rejected";
  reason?: string;
};

type PatchActionRequest = {
  action: "apply" | "reject";
  proposalId: string;
  reason?: string;
  files?: Array<{
    path: string;
    content: string;
  }>;
};

function stripEphemeralSystemMessages(messages: SessionMessage[] | undefined) {
  return (messages ?? []).filter(
    (message) => !isEphemeralContextMessage(message)
  );
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string"
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

async function getCheckpointMessages(sessionId: string) {
  let values: Record<string, unknown> | null = null;

  try {
    const snapshot = await getRuntimeThreadState(sessionId);
    values =
      snapshot.values && typeof snapshot.values === "object"
        ? (snapshot.values as Record<string, unknown>)
        : null;
  } catch {
    const persisted = await getPersistedRuntimeThreadState(sessionId);
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const useLangGraph = searchParams.get("useLangGraph") === "true";
  const includeSessions = searchParams.get("includeSessions") === "true";
  const includeRuns = searchParams.get("includeRuns") === "true";
  const includeTrace = searchParams.get("includeTrace") === "true";
  const runId = searchParams.get("runId");

  if (includeSessions) {
    const sessions = await listSessions();
    return Response.json({
      sessions,
    });
  }

  if (includeRuns) {
    if (!sessionId) {
      return Response.json(
        {
          error: "Missing sessionId",
        },
        { status: 400 }
      );
    }

    const runs = await listSessionRuns(sessionId);
    return Response.json({
      runs,
    });
  }

  if (includeTrace) {
    if (!runId) {
      return Response.json(
        {
          error: "Missing runId",
        },
        { status: 400 }
      );
    }

    const trace = await getRunTrace(runId);
    return Response.json({
      trace,
    });
  }

  if (!sessionId) {
    return Response.json(
      {
        error: "Missing sessionId",
      },
      { status: 400 }
    );
  }

  const storedMessages = toUiMessages(await getFullSessionMessages(sessionId));
  let messages = storedMessages;

  if (messages.length === 0 && useLangGraph) {
    try {
      messages = await getCheckpointMessages(sessionId);
    } catch (error) {
      console.error(error);
    }
  }

  return Response.json({
    sessionId,
    messages,
  });
}

export async function POST(req: Request) {
  const body = await req.json();

  console.log("api body:", body);

  const sessionId = body.sessionId;
  const messages = body.messages;
  const useLangGraph = body.useLangGraph === true;
  const useMultiAgent = body.useMultiAgent === true;
  const confirmation = body.confirmation;
  const patchAction = body.patchAction;
  const deleteRequested = body.deleteSession === true;

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return Response.json(
      {
        error: "Missing sessionId. Expected body: { sessionId, messages }",
        received: body,
      },
      { status: 400 }
    );
  }

  if (deleteRequested) {
    await deleteSession(sessionId);
    return Response.json({
      ok: true,
      deleted: true,
      sessionId,
    });
  }

  const latestIncomingUserMessage = Array.isArray(messages)
    ? [...messages]
        .reverse()
        .find((message) => isClientMessage(message) && message.role === "user")
    : null;

  if ((useLangGraph || useMultiAgent) && confirmation && typeof confirmation === "object") { // 如果请求中包含 confirmation 对象，说明这是一个工具执行的确认请求，调用对应 runtime 来恢复运行，并传入用户的决策
    await ensureSession(sessionId);
    const runId = crypto.randomUUID();
    await createAgentRun({
      runId,
      sessionId,
      runtimeType: useMultiAgent ? "multi_agent" : "langgraph",
      trigger: "resume",
      entrypoint: "/api/chat",
      latestUserTask: latestIncomingUserMessage?.content ?? null,
    });
    const decision = (confirmation as ConfirmationRequest).decision; // 从 confirmation 对象中提取用户的决策，应该是 "approved" 或 "rejected"
    const reason = (confirmation as ConfirmationRequest).reason; // 从 confirmation 对象中提取用户拒绝的原因（如果有的话）

    if (decision !== "approved" && decision !== "rejected") { // 如果用户的决策无效，返回一个错误响应
      return Response.json(
        {
          error:
            "Invalid confirmation payload. Expected { decision: 'approved' | 'rejected' }",
          received: body,
        },
        { status: 400 }
      );
    }

    const resumePayload = {
      approved: decision === "approved",
      reason:
        typeof reason === "string" && reason.trim() !== ""
          ? reason
          : decision === "rejected"
            ? "User rejected execution"
            : undefined,
    };

    const stream = useMultiAgent
        ? await resumeMultiAgentRuntime(
          resumePayload,
          {
            threadId: sessionId,
            runId,
            onFinish(nextMessages) {
              void (async () => {
                await setSessionMessages(
                  sessionId,
                  stripEphemeralSystemMessages(nextMessages)
                );
                await maybeSummarizeSession(sessionId);
              })();
            },
          }
        )
        : await resumeLangGraphRuntime(
          resumePayload,
          {
            threadId: sessionId,// 传入线程 ID 以便在恢复运行时能够找到对应的线程状态
            runId,
            onFinish(nextMessages) {
              void (async () => {
                await setSessionMessages(
                  sessionId,
                  stripEphemeralSystemMessages(nextMessages)
                );
                await maybeSummarizeSession(sessionId);
              })();
            },
          }
        );

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (patchAction && typeof patchAction === "object") {
    const actionPayload = patchAction as PatchActionRequest;

    if (
      (actionPayload.action !== "apply" && actionPayload.action !== "reject") ||
      typeof actionPayload.proposalId !== "string" ||
      actionPayload.proposalId.trim() === ""
    ) {
      return Response.json(
        {
          error:
            "Invalid patchAction payload. Expected { action: 'apply' | 'reject', proposalId }",
          received: body,
        },
        { status: 400 }
      );
    }

    try {
      const result =
        actionPayload.action === "apply"
          ? await applyPatchProposal({
              proposalId: actionPayload.proposalId,
              files: Array.isArray(actionPayload.files)
                ? actionPayload.files.filter(
                    (file): file is { path: string; content: string } =>
                      !!file &&
                      typeof file === "object" &&
                      typeof file.path === "string" &&
                      typeof file.content === "string"
                  )
                : undefined,
            })
          : await rejectPatchProposal({
              proposalId: actionPayload.proposalId,
              reason:
                typeof actionPayload.reason === "string"
                  ? actionPayload.reason
                  : undefined,
            });

      return Response.json({
        ok: true,
        result,
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown patch action error",
        },
        { status: 400 }
      );
    }
  }

  if (!Array.isArray(messages)) {
    return Response.json(
      {
        error: "Missing messages. Expected body: { sessionId, messages: [...] }",
        received: body,
      },
      { status: 400 }
    );
  }

  const latestUserMessage = latestIncomingUserMessage;

  if (!latestUserMessage) {
    return Response.json(
      {
        error: "Missing latest user message",
        received: body,
      },
      { status: 400 }
    );
  }

  await ensureSession(sessionId);
  const runId = crypto.randomUUID();
  await createAgentRun({
    runId,
    sessionId,
    runtimeType: useMultiAgent ? "multi_agent" : useLangGraph ? "langgraph" : "manual",
    trigger: "request",
    entrypoint: "/api/chat",
    latestUserTask: latestUserMessage.content,
  });

  const sessionMessages = await buildAgentContext(
    sessionId,
    latestUserMessage.content
  );
  sessionMessages.push({
    role: "user",
    content: latestUserMessage.content,
  });

  const stream = useMultiAgent
    ? await runMultiAgentRuntime(sessionMessages, {
        threadId: sessionId,
        requirePlanApproval: true,
        runId,
        onFinish(nextMessages) {
          void (async () => {
            await setSessionMessages(
              sessionId,
              stripEphemeralSystemMessages(nextMessages)
            );
            await maybeSummarizeSession(sessionId);
          })();
        },
      })
    : useLangGraph
      ? await runLangGraphRuntime(sessionMessages, {
          threadId: sessionId,
          runId,
          onFinish(nextMessages) {
            void (async () => {
              await setSessionMessages(
                sessionId,
                stripEphemeralSystemMessages(nextMessages)
              );
              await maybeSummarizeSession(sessionId);
            })();
          },
        })
      : await runAgentRuntime(sessionMessages, {
          sessionId,
          runId,
          onFinish(nextMessages) {
            void (async () => {
              await setSessionMessages(
                sessionId,
                stripEphemeralSystemMessages(nextMessages)
              );
              await maybeSummarizeSession(sessionId);
            })();
          },
        });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache", // 禁止缓存以确保客户端能够实时接收数据
      Connection: "keep-alive", // 保持连接以便持续发送数据
    },
  });
}
