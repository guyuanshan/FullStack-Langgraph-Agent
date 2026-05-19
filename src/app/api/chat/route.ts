import { runAgentRuntime } from "../../../lib/agent/runtime";
import {
  resumeLangGraphRuntime,
  runLangGraphRuntime,
} from "../../../lib/agent/langgraphRuntime";
import { getRuntimeThreadState } from "../../../lib/graph";
import {
  cloneSessionMessages,
  setSessionMessages,
  type SessionMessage,
} from "../../../lib/chat/session-store";
import {
  applyPatchProposal,
  rejectPatchProposal,
} from "../../../lib/code-agent/proposals";

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
  const snapshot = await getRuntimeThreadState(sessionId);
  const values =
    snapshot.values && typeof snapshot.values === "object"
      ? (snapshot.values as Record<string, unknown>)
      : null;
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

  if (!sessionId) {
    return Response.json(
      {
        error: "Missing sessionId",
      },
      { status: 400 }
    );
  }

  const storedMessages = toUiMessages(cloneSessionMessages(sessionId));
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
  const confirmation = body.confirmation;
  const patchAction = body.patchAction;

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return Response.json(
      {
        error: "Missing sessionId. Expected body: { sessionId, messages }",
        received: body,
      },
      { status: 400 }
    );
  }

  if (useLangGraph && confirmation && typeof confirmation === "object") { // 如果请求中包含 confirmation 对象，说明这是一个工具执行的确认请求，调用 resumeLangGraphRuntime 来恢复运行，并传入用户的决策
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

    const stream = await resumeLangGraphRuntime( // 调用 resumeLangGraphRuntime 来恢复运行，并传入用户的决策
      {
        approved: decision === "approved",
        reason:
          typeof reason === "string" && reason.trim() !== ""
            ? reason
            : decision === "rejected"
              ? "User rejected tool execution"
              : undefined,
      },
      {
        threadId: sessionId,// 传入线程 ID 以便在恢复运行时能够找到对应的线程状态
        onFinish(nextMessages) {
          setSessionMessages(sessionId, nextMessages); // 在运行完成后，调用 onFinish 回调函数，传入最新的消息列表，以便更新会话状态
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

  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => isClientMessage(message) && message.role === "user");

  if (!latestUserMessage) {
    return Response.json(
      {
        error: "Missing latest user message",
        received: body,
      },
      { status: 400 }
    );
  }

  const sessionMessages = cloneSessionMessages(sessionId);
  sessionMessages.push({
    role: "user",
    content: latestUserMessage.content,
  });

  const stream = useLangGraph
    ? await runLangGraphRuntime(sessionMessages, {
        threadId: sessionId,
        onFinish(nextMessages) {
          setSessionMessages(sessionId, nextMessages);
        },
      })
    : await runAgentRuntime(sessionMessages, {
        sessionId,
        onFinish(nextMessages) {
          setSessionMessages(sessionId, nextMessages);
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
