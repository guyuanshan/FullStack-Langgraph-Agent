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
