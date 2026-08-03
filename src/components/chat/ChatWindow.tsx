"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage, StreamEvent } from "../../types/chat";
import { AccountMenu } from "../auth/AccountMenu";
import { Message } from "../chat/Message";
import { MessageInput } from "../chat/MessageInput";
import { TracePanel } from "./TracePanel";

const CHAT_SESSION_STORAGE_KEY_PREFIX =
    "fullstack-langgraph-agent:session-id";
const USE_LANGGRAPH = true;
const USE_MULTI_AGENT = true;

function chatSessionStorageKey(tenantId: string) {
    return `${CHAT_SESSION_STORAGE_KEY_PREFIX}:${tenantId}`;
}

type ApiMessage = {
    role: "user" | "assistant";
    content: string;
};

type SessionResponse = {
    sessionId: string;
    messages: ApiMessage[];
};

type SessionListItem = {
    id: string;
    title: string | null;
    summary: string | null;
    messageCount: number;
    lastMessageAt: string | null;
    updatedAt: string;
    createdAt: string;
};

type SessionListResponse = {
    sessions: SessionListItem[];
};

type ConfirmationDecision = "approved" | "rejected";

type PatchActionResponse = {
    ok: boolean;
    result?: unknown;
    error?: string;
};

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
    // 创建一个新的聊天消息对象
    return {
        id: crypto.randomUUID(),
        role,
        content,
        createdAt: Date.now(),
    };
}

function parseStreamEvents(buffer: string) {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    const events: StreamEvent[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
            continue;
        }

        events.push(JSON.parse(trimmed) as StreamEvent);
    }

    return { events, rest };
}

function createSessionId() {
    return crypto.randomUUID();
}

function getOrCreateSessionId(tenantId: string) {
    if (typeof window === "undefined") {
        return null;
    }

    const storageKey = chatSessionStorageKey(tenantId);
    const storedSessionId =
        window.localStorage.getItem(storageKey) ?? createSessionId();

    window.localStorage.setItem(storageKey, storedSessionId);

    return storedSessionId;
}

function toChatMessages(messages: ApiMessage[]) {
    return messages.map((message) => createMessage(message.role, message.content));
}

function canStartRuns(role: string) {
    return role === "owner" || role === "admin" || role === "member";
}

async function streamResponse(
    url: string,
    body: Record<string, unknown>,
    assistantMessageId: string,
    applyEvent: (event: StreamEvent, assistantMessageId: string) => void
) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    if (!response.body) {
        throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    while (!done) {
        const result = await reader.read();

        done = result.done;

        const chunk = decoder.decode(result.value || new Uint8Array(), {
            stream: true,
        });

        if (chunk) {
            buffer += chunk;
            const { events, rest } = parseStreamEvents(buffer);
            buffer = rest;

            for (const event of events) {
                applyEvent(event, assistantMessageId);
            }
        }
    }

    if (buffer.trim()) {
        const { events } = parseStreamEvents(buffer + "\n");

        for (const event of events) {
            applyEvent(event, assistantMessageId);
        }
    }
}

type ChatWindowProps = {
    account: {
        email: string;
        tenantId: string;
        tenantName: string;
        role: string;
    };
};

// 聊天窗口组件，展示消息列表并包含消息输入框
export function ChatWindow({ account }: ChatWindowProps) {
    // 聊天消息的状态，初始时包含一条助手消息
    const [messages, setMessages] = useState<ChatMessage[]>([
        createMessage("assistant", "你好，我是你的 AI Agent 助手。"),
    ]);
    // 加载状态，防止重复发送消息
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(() =>
        getOrCreateSessionId(account.tenantId)
    );
    const [sessions, setSessions] = useState<SessionListItem[]>([]);
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);
    const [currentRunStatus, setCurrentRunStatus] = useState<
        "running" | "completed" | "interrupted" | "error" | null
    >(null);
    const [currentAgent, setCurrentAgent] = useState<{
        agentName: "planner" | "code" | "browser" | "reviewer" | "tool_executor" | "finalizer";
        phase: "started" | "completed" | "handoff" | "error";
        message: string;
        latencyMs?: number;
        toolCount?: number;
    } | null>(null);
    const [isSessionLoading, setIsSessionLoading] = useState(
        () => sessionId !== null
    );

    const activeTenantIdRef = useRef(account.tenantId);

    useEffect(() => {
        if (activeTenantIdRef.current === account.tenantId) {
            return;
        }

        activeTenantIdRef.current = account.tenantId;
        const nextSessionId = getOrCreateSessionId(account.tenantId);
        setSessionId(nextSessionId);
        setMessages([createMessage("assistant", "你好，我是你的 AI Agent 助手。")]);
        setIsSessionLoading(nextSessionId !== null);
        setCurrentRunId(null);
        setCurrentRunStatus(null);
        setCurrentAgent(null);
        setSessions([]);
    }, [account.tenantId]);

    useEffect(() => {
        let isCancelled = false;

        async function loadSessions() {
            try {
                const response = await fetch("/api/sessions");

                if (!response.ok) {
                    throw new Error(`Failed to load sessions ${response.status}`);
                }

                const data = (await response.json()) as SessionListResponse;

                if (!isCancelled) {
                    setSessions(data.sessions);
                }
            } catch (error) {
                console.error(error);
            }
        }

        void loadSessions();

        return () => {
            isCancelled = true;
        };
    }, [sessionId, isLoading]);

    useEffect(() => {
        if (!sessionId) {
            return;
        }

        const currentSessionId = sessionId;
        let isCancelled = false;

        async function loadSession() {
            try {
                const response = await fetch(
                    `/api/sessions/${encodeURIComponent(currentSessionId)}/messages?useLangGraph=${String(USE_LANGGRAPH)}`
                );

                if (!response.ok) {
                    throw new Error(`Failed to load session ${response.status}`);
                }

                const data = (await response.json()) as SessionResponse;

                if (isCancelled) {
                    return;
                }

                if (data.messages.length > 0) {
                    setMessages(toChatMessages(data.messages));
                }
            } catch (error) {
                console.error(error);
            } finally {
                if (!isCancelled) {
                    setIsSessionLoading(false);
                }
            }
        }

        void loadSession();

        return () => {
            isCancelled = true;
        };
    }, [sessionId]);

    function applyStreamEvent(
        event: StreamEvent,
        assistantMessageId: string,
        setState: Dispatch<SetStateAction<ChatMessage[]>>
    ) {
        if (event.type === "text") {
            setState((prev) =>
                prev.map((message) =>
                    message.id === assistantMessageId
                        ? {
                            ...message,
                            content: message.content + event.content,
                        }
                        : message
                )
            );
            return;
        }

        if (event.type === "run_started") {
            setCurrentRunId(event.runId);
            setCurrentRunStatus("running");
            return;
        }

        if (event.type === "run_finished") {
            setCurrentRunId(event.runId);
            setCurrentRunStatus(event.status);
            return;
        }

        if (event.type === "tool_start") {
            setState((prev) => {
                const existingIndex = prev.findIndex(
                    (message) =>
                        message.role === "tool" &&
                        message.toolCallId === event.toolCallId
                );

                if (existingIndex === -1) {
                    return [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "tool",
                            content: "",
                            createdAt: Date.now(),
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            toolStatus: "running",
                            toolArgs: event.args,
                            toolSummary: event.toolSummary,
                            toolRiskLevel: event.toolRiskLevel,
                            toolPermissions: event.toolPermissions,
                            metadata: {
                                assistantMessageId,
                            },
                        },
                    ];
                }

                return prev.map((message, index) =>
                    index === existingIndex
                        ? {
                            ...message,
                            toolStatus: "running",
                            toolArgs: event.args,
                            toolSummary: event.toolSummary,
                            toolRiskLevel: event.toolRiskLevel,
                            toolPermissions: event.toolPermissions,
                            toolError: undefined,
                            confirmMessage: undefined,
                        }
                        : message
                );
            });
            return;
        }

        if (event.type === "agent_status") {
            setCurrentAgent({
                agentName: event.agentName,
                phase: event.phase,
                message: event.message,
                latencyMs: event.latencyMs,
                toolCount: event.toolCount,
            });
            return;
        }

        if (event.type === "agent_delta") {
            setCurrentAgent((prev) =>
                prev && prev.agentName === event.agentName
                    ? {
                        ...prev,
                        message: prev.message + event.text,
                    }
                    : {
                        agentName: event.agentName,
                        phase: "started",
                        message: event.text,
                    }
            );
            return;
        }

        if (event.type === "confirm_request") {
            setState((prev) => {
                const existingIndex = prev.findIndex(
                    (message) =>
                        message.role === "tool" &&
                        message.toolCallId === event.toolCallId
                );

                if (existingIndex === -1) {
                    return [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "tool",
                            content: "",
                            createdAt: Date.now(),
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            approvalId: event.approvalId,
                            toolStatus: "confirm_required",
                            toolArgs: event.args,
                            confirmMessage: event.message,
                            toolSummary: event.toolSummary,
                            toolRiskLevel: event.toolRiskLevel,
                            toolPermissions: event.toolPermissions,
                            metadata: {
                                assistantMessageId,
                            },
                        },
                    ];
                }

                return prev.map((message, index) =>
                    index === existingIndex
                        ? {
                            ...message,
                            approvalId: event.approvalId,
                            toolStatus: "confirm_required",
                            toolArgs: event.args,
                            confirmMessage: event.message,
                            toolSummary: event.toolSummary,
                            toolRiskLevel: event.toolRiskLevel,
                            toolPermissions: event.toolPermissions,
                            toolError: undefined,
                        }
                        : message
                );
            });
            return;
        }

        if (event.type === "tool_result") {
            setState((prev) => {
                const toolIndex = [...prev].reverse().findIndex(
                    (message) =>
                        message.role === "tool" &&
                        (message.toolCallId === event.toolCallId ||
                            (message.toolName === event.toolName &&
                                message.toolStatus === "running"))
                );

                if (toolIndex === -1) {
                    return [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "tool",
                            content: "",
                            createdAt: Date.now(),
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            toolStatus: "success",
                            toolResult: event.result,
                            toolSummary: event.toolSummary,
                        },
                    ];
                }

                const actualIndex = prev.length - 1 - toolIndex;

                return prev.map((message, index) =>
                    index === actualIndex
                        ? {
                            ...message,
                            content: "",
                            toolStatus: "success",
                            toolResult: event.result,
                            toolSummary: event.toolSummary ?? message.toolSummary,
                            confirmMessage: undefined,
                        }
                        : message
                );
            });
            return;
        }

        if (event.type === "tool_progress") {
            setState((prev) =>
                prev.map((message) =>
                    message.role === "tool" &&
                    message.toolCallId === event.toolCallId
                        ? {
                            ...message,
                            toolProgress: event.progress,
                        }
                        : message
                )
            );
            return;
        }

        if (event.type === "tool_error") {
            setState((prev) => {
                const toolIndex = [...prev].reverse().findIndex(
                    (message) =>
                        message.role === "tool" &&
                        (message.toolCallId === event.toolCallId ||
                            (message.toolName === event.toolName &&
                                (message.toolStatus === "running" ||
                                    message.toolStatus === "confirm_required")))
                );

                if (toolIndex === -1) {
                    return [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: "tool",
                            content: "",
                            createdAt: Date.now(),
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            toolStatus: "error",
                            toolError: event.message,
                            toolSummary: event.toolSummary,
                        },
                    ];
                }

                const actualIndex = prev.length - 1 - toolIndex;

                return prev.map((message, index) =>
                    index === actualIndex
                        ? {
                            ...message,
                            content: "",
                            toolStatus: "error",
                            toolError: event.message,
                            toolSummary: event.toolSummary ?? message.toolSummary,
                            confirmMessage: undefined,
                        }
                        : message
                );
            });
            return;
        }

        setState((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                role: "error",
                content: event.message,
                createdAt: Date.now(),
            },
        ]);
    }

    // 处理发送消息的函数，负责与后端 API 交互并更新消息列表
    async function handleSendMessage(content: string) {
        if (isLoading || isSessionLoading || !sessionId) return;
        if (!canStartRuns(account.role)) return;
        // 创建一个新的用户消息对象，并添加到消息列表中
        const userMessage = createMessage("user", content);
        // 创建一个新的助手消息对象，初始内容为空，后续会通过 SSE 更新内容
        const assistantMessage = createMessage("assistant", "");

        setMessages((prev) => [...prev, userMessage, assistantMessage]);
        setIsLoading(true);

        try {
            await streamResponse(
                `/api/sessions/${encodeURIComponent(sessionId)}/runs`,
                {
                    kind: "start",
                    useLangGraph: USE_LANGGRAPH,
                    useMultiAgent: USE_MULTI_AGENT,
                    messages: [
                        {
                            role: "user",
                            content,
                        },
                    ],
                },
                assistantMessage.id,
                (event, nextAssistantMessageId) =>
                    applyStreamEvent(event, nextAssistantMessageId, setMessages)
            );
            const sessionsResponse = await fetch("/api/sessions");
            if (sessionsResponse.ok) {
                const data = (await sessionsResponse.json()) as SessionListResponse;
                setSessions(data.sessions);
            }
        } catch (error) {
            console.error(error);
            // 如果发生错误，更新助手消息的内容为错误提示
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === assistantMessage.id
                        ? {
                            ...message,
                            content: "抱歉，SSE 请求失败了。",
                        }
                        : message
                )
            );
        } finally {
            setIsLoading(false);
        }
    }

    function handleCreateSession() {
        const nextSessionId = createSessionId();
        window.localStorage.setItem(
            chatSessionStorageKey(account.tenantId),
            nextSessionId
        );
        setSessionId(nextSessionId);
        setMessages([createMessage("assistant", "你好，我是你的 AI Agent 助手。")]);
        setIsSessionLoading(false);
        setCurrentRunId(null);
        setCurrentRunStatus(null);
        setCurrentAgent(null);
    }

    function handleSwitchSession(nextSessionId: string) {
        window.localStorage.setItem(
            chatSessionStorageKey(account.tenantId),
            nextSessionId
        );
        setSessionId(nextSessionId);
        setIsSessionLoading(true);
        setCurrentRunId(null);
        setCurrentRunStatus(null);
        setCurrentAgent(null);
    }

    async function handleDeleteSession(targetSessionId: string) {
        if (isLoading) {
            return;
        }

        await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}`, {
            method: "DELETE",
        });

        const remainingSessions = sessions.filter(
            (session) => session.id !== targetSessionId
        );
        setSessions(remainingSessions);

        if (sessionId === targetSessionId) {
            if (remainingSessions[0]?.id) {
                handleSwitchSession(remainingSessions[0].id);
            } else {
                handleCreateSession();
            }
        }
    }

    async function handleToolConfirmation(
        message: ChatMessage,
        decision: ConfirmationDecision
    ) {
        if (isLoading || !sessionId) {
            return;
        }

        const assistantMessageId =
            typeof message.metadata?.assistantMessageId === "string"
                ? message.metadata.assistantMessageId
                : messages.filter((item) => item.role === "assistant").at(-1)?.id;

        if (!assistantMessageId) {
            return;
        }

        setMessages((prev) =>
            prev.map((item) =>
                item.id === message.id
                    ? {
                        ...item,
                        toolStatus: "running",
                    }
                    : item
            )
        );
        setIsLoading(true);

        try {
            const approvalId = message.approvalId;

            if (!approvalId) {
                throw new Error("Missing server approvalId for confirmation.");
            }

            await streamResponse(
                `/api/tool-approvals/${encodeURIComponent(approvalId)}/decision`,
                {
                    decision,
                },
                assistantMessageId,
                (event, nextAssistantMessageId) =>
                    applyStreamEvent(event, nextAssistantMessageId, setMessages)
            );
        } catch (error) {
            console.error(error);
            setMessages((prev) =>
                prev.map((item) =>
                    item.id === message.id
                        ? {
                            ...item,
                            toolStatus: "error",
                            toolError: "确认请求发送失败。",
                        }
                        : item
                )
            );
        } finally {
            setIsLoading(false);
        }
    }

    async function handlePatchProposalAction(
        message: ChatMessage,
        action: "apply" | "reject",
        files?: Array<{ path: string; content: string }>
    ) {
        if (isLoading || !sessionId) {
            return;
        }

        const proposalId =
            message.toolResult &&
            typeof message.toolResult === "object" &&
            typeof (message.toolResult as Record<string, unknown>).proposalId === "string"
                ? ((message.toolResult as Record<string, unknown>).proposalId as string)
                : null;

        if (!proposalId) {
            return;
        }

        setIsLoading(true);
        setMessages((prev) =>
            prev.map((item) =>
                item.id === message.id
                    ? {
                        ...item,
                        toolStatus: "running",
                        toolError: undefined,
                    }
                    : item
            )
        );

        try {
            const response = await fetch(
                `/api/patch-proposals/${encodeURIComponent(proposalId)}/decision`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        action,
                        files,
                    }),
                }
            );

            const data = (await response.json()) as PatchActionResponse;

            if (!response.ok || !data.ok) {
                throw new Error(data.error ?? `Patch action failed with status ${response.status}`);
            }

            setMessages((prev) =>
                prev.map((item) =>
                    item.id === message.id
                        ? {
                            ...item,
                            toolStatus: "success",
                            toolResult: data.result,
                        }
                        : item
                )
            );
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Patch action failed";

            setMessages((prev) =>
                prev.map((item) =>
                    item.id === message.id
                        ? {
                            ...item,
                            toolStatus: "error",
                            toolError: errorMessage,
                        }
                        : item
                )
            );
        } finally {
            setIsLoading(false);
        }
    }
    // 渲染聊天窗口，展示消息列表和消息输入组件
    return (
        <main className="mx-auto flex h-screen max-w-[1600px]">
            <aside className="hidden w-80 shrink-0 border-r bg-slate-50 md:flex md:flex-col">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h2 className="text-sm font-semibold text-slate-900">Sessions</h2>
                    <button
                        type="button"
                        onClick={handleCreateSession}
                        className="rounded-lg bg-black px-3 py-2 text-xs text-white"
                    >
                        新建会话
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                    <div className="space-y-2">
                        {sessions.map((session) => (
                            <div
                                key={session.id}
                                className={`rounded-xl border p-3 ${
                                    session.id === sessionId
                                        ? "border-slate-900 bg-white"
                                        : "border-slate-200 bg-white/70"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleSwitchSession(session.id)}
                                        className="text-left"
                                    >
                                        <p className="text-sm font-semibold text-slate-900">
                                            {session.title ?? "Untitled session"}
                                        </p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleDeleteSession(session.id)}
                                        className="text-xs text-slate-500"
                                    >
                                        删除
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleSwitchSession(session.id)}
                                    className="mt-1 block w-full text-left"
                                >
                                    <p className="line-clamp-3 text-xs text-slate-600">
                                        {session.summary ?? `${session.messageCount} messages`}
                                    </p>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="border-b px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <h1 className="text-lg font-semibold">Fullstack LangGraph Agent</h1>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleCreateSession}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 md:hidden"
                            >
                                新建会话
                            </button>
                            <AccountMenu
                                email={account.email}
                                tenantName={account.tenantName}
                                role={account.role}
                            />
                        </div>
                    </div>
                </header>

                <section className="flex-1 space-y-4 overflow-y-auto p-4">
                    {messages.map((message) => (
                        <Message
                            key={message.id}
                            message={message}
                            onConfirmTool={(toolMessage) =>
                                void handleToolConfirmation(toolMessage, "approved")
                            }
                            onRejectTool={(toolMessage) =>
                                void handleToolConfirmation(toolMessage, "rejected")
                            }
                            onApprovePatch={(toolMessage, files) =>
                                void handlePatchProposalAction(toolMessage, "apply", files)
                            }
                            onRejectPatch={(toolMessage) =>
                                void handlePatchProposalAction(toolMessage, "reject")
                            }
                        />
                    ))}
                </section>

                {canStartRuns(account.role) ? (
                    <MessageInput onSendMessage={handleSendMessage} />
                ) : (
                    <div className="border-t px-4 py-3 text-sm text-slate-500">
                        当前角色为 viewer，只能查看会话，不能发起 Agent Run。
                    </div>
                )}
            </div>

            <TracePanel
                currentRunId={currentRunId}
                currentRunStatus={currentRunStatus}
                currentAgent={currentAgent}
            />
        </main>
    );
}
