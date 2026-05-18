"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage, StreamEvent } from "../../types/chat";
import { Message } from "../chat/Message";
import { MessageInput } from "../chat/MessageInput";

const CHAT_SESSION_STORAGE_KEY = "fullstack-langgraph-agent:session-id";
const USE_LANGGRAPH = true;

type ApiMessage = {
    role: "user" | "assistant";
    content: string;
};

type SessionResponse = {
    sessionId: string;
    messages: ApiMessage[];
};

type ConfirmationDecision = "approved" | "rejected";

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

function toApiMessages(messages: ChatMessage[]) {
    return messages
        .filter(
            (message) =>
                (message.role === "user" || message.role === "assistant") &&
                message.content.trim() !== ""
        )
        .map((message) => ({
            role: message.role,
            content: message.content,
        }));
}

function createSessionId() {
    return crypto.randomUUID();
}

function getOrCreateSessionId() {
    if (typeof window === "undefined") {
        return null;
    }

    const storedSessionId =
        window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY) ?? createSessionId();

    window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, storedSessionId);

    return storedSessionId;
}

function toChatMessages(messages: ApiMessage[]) {
    return messages.map((message) => createMessage(message.role, message.content));
}

async function streamResponse(
    body: Record<string, unknown>,
    assistantMessageId: string,
    applyEvent: (event: StreamEvent, assistantMessageId: string) => void
) {
    const response = await fetch("/api/chat", {
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

// 聊天窗口组件，展示消息列表并包含消息输入框
export function ChatWindow() {
    // 聊天消息的状态，初始时包含一条助手消息
    const [messages, setMessages] = useState<ChatMessage[]>([
        createMessage("assistant", "你好，我是你的 AI Agent 助手。"),
    ]);
    // 加载状态，防止重复发送消息
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId] = useState<string | null>(() => getOrCreateSessionId());
    const [isSessionLoading, setIsSessionLoading] = useState(
        () => sessionId !== null
    );

    useEffect(() => {
        if (!sessionId) {
            return;
        }

        const currentSessionId = sessionId;
        let isCancelled = false;

        async function loadSession() {
            try {
                const response = await fetch(
                    `/api/chat?sessionId=${encodeURIComponent(currentSessionId)}&useLangGraph=${String(USE_LANGGRAPH)}`
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
        // 创建一个新的用户消息对象，并添加到消息列表中
        const userMessage = createMessage("user", content);
        // 创建一个新的助手消息对象，初始内容为空，后续会通过 SSE 更新内容
        const assistantMessage = createMessage("assistant", "");

        setMessages((prev) => [...prev, userMessage, assistantMessage]);
        setIsLoading(true);

        const nextMessages = [
            ...toApiMessages(messages),
            {
                role: "user",
                content: content,
            },
        ];

        try {
            await streamResponse(
                {
                    sessionId,
                    useLangGraph: USE_LANGGRAPH,
                    messages: nextMessages,
                },
                assistantMessage.id,
                (event, nextAssistantMessageId) =>
                    applyStreamEvent(event, nextAssistantMessageId, setMessages)
            );
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
            await streamResponse(
                {
                    sessionId,
                    useLangGraph: USE_LANGGRAPH,
                    confirmation: {
                        decision,
                    },
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
    // 渲染聊天窗口，展示消息列表和消息输入组件
    return (
        <main className="mx-auto flex h-screen max-w-3xl flex-col">
            <header className="border-b px-4 py-3">
                <h1 className="text-lg font-semibold">Fullstack LangGraph Agent</h1>
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
                    />
                ))}
            </section>

            <MessageInput onSendMessage={handleSendMessage} />
        </main>
    );
}
