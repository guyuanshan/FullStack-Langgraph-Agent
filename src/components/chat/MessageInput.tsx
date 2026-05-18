"use client";

import { useState } from "react";

// 组件：消息输入框
interface MessageInputProps {
    onSendMessage: (content: string) => void;
}

// 消息输入组件，允许用户输入消息并发送
export function MessageInput({ onSendMessage }: MessageInputProps) {
    // 输入框的状态
    const [input, setInput] = useState("");
    // 处理表单提交事件
    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        // 阻止默认的表单提交行为
        event.preventDefault();
        // 去除输入内容的前后空白
        const content = input.trim();

        if (!content) return;
        // 调用父组件传入的发送消息函数
        onSendMessage(content);
        setInput("");
    }

    return (
        <form
            onSubmit={handleSubmit}
            className="flex gap-2 border-t bg-white p-4"
        >
            <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入消息..."
                className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none focus:border-black"
            />

            <button
                type="submit"
                className="rounded-xl bg-black px-5 py-3 text-sm text-white"
            >
                发送
            </button>
        </form>
    );
}

