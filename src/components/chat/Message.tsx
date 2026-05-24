import type { ChatMessage } from "../../types/chat";
import { ToolCallCard } from "./ToolCallCard";

// 一个简单的聊天窗口组件，展示用户和助手的消息
type MessageProps = {
  message: ChatMessage;
  onConfirmTool?: (message: ChatMessage) => void;
  onRejectTool?: (message: ChatMessage) => void;
  onApprovePatch?: (
    message: ChatMessage,
    files: Array<{ path: string; content: string }>
  ) => void;
  onRejectPatch?: (message: ChatMessage) => void;
};

export function Message({
  message,
  onConfirmTool,
  onRejectTool,
  onApprovePatch,
  onRejectPatch,
}: MessageProps) {
    // 根据消息角色设置不同的样式
    const isUser = message.role === "user";
    const isTool = message.role === "tool";
    const isError = message.role === "error";
    const isAgent = message.role === "agent";

    if (isTool) {
      return (
        <div className="flex justify-start">
          <ToolCallCard
            message={message}
            onConfirm={onConfirmTool}
            onReject={onRejectTool}
            onApprovePatch={onApprovePatch}
            onRejectPatch={onRejectPatch}
          />
        </div>
      );
    }

    if (isAgent) {
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">
              {message.agentName ?? "agent"} · {message.agentPhase ?? "status"}
            </p>
            <p className="mt-1 whitespace-pre-wrap leading-6">{message.content}</p>
            {message.latencyMs || message.toolCount ? (
              <p className="mt-2 text-xs text-indigo-600">
                {message.latencyMs ? `Latency: ${message.latencyMs}ms` : ""}
                {message.latencyMs && message.toolCount !== undefined ? " · " : ""}
                {message.toolCount !== undefined ? `Tools: ${message.toolCount}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    // 用户消息靠右显示，助手消息靠左显示
    return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-black text-white"
            : isError
              ? "bg-red-50 text-red-700"
              : isTool
                ? "bg-blue-50 text-blue-900"
                : "bg-gray-100 text-gray-900"
        }`}
      >
        {/* 消息内容 */}
        {message.content}
      </div>
    </div>
  );
}
