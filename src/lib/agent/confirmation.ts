export type ToolConfirmationInterrupt = {
  kind: "tool_confirmation";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  message: string;
  toolSummary?: string;
  toolRiskLevel?: "safe" | "confirm_required" | "dangerous";
  toolPermissions?: Array<"read" | "write" | "delete" | "execute">;
};

export type ToolConfirmationResume = {
  approved: boolean;
  reason?: string;
};

export function isToolConfirmationInterrupt(
  value: unknown
): value is ToolConfirmationInterrupt {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.kind === "tool_confirmation" &&
    typeof candidate.toolCallId === "string" &&
    typeof candidate.toolName === "string" &&
    typeof candidate.message === "string" &&
    !!candidate.args &&
    typeof candidate.args === "object"
  );
}
