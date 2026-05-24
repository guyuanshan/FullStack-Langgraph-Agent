type CurrentAgentStatus = {
  agentName: "planner" | "code" | "browser" | "reviewer" | "tool_executor" | "finalizer";
  phase: "started" | "completed" | "handoff" | "error";
  message: string;
  latencyMs?: number;
  toolCount?: number;
} | null;

type CurrentAgentName = NonNullable<CurrentAgentStatus>["agentName"];

type TracePanelProps = {
  currentRunId: string | null;
  currentRunStatus: "running" | "completed" | "interrupted" | "error" | null;
  currentAgent: CurrentAgentStatus;
};

function toAgentLabel(agentName: CurrentAgentName) {
  switch (agentName) {
    case "planner":
      return "Planner";
    case "code":
      return "Code Agent";
    case "browser":
      return "Browser Agent";
    case "reviewer":
      return "Reviewer";
    case "tool_executor":
      return "Tool Executor";
    case "finalizer":
      return "Finalizer";
    default:
      return "Agent";
  }
}

export function TracePanel({
  currentRunId,
  currentRunStatus,
  currentAgent,
}: TracePanelProps) {
  return (
    <aside className="hidden w-80 shrink-0 border-l bg-slate-50 xl:flex xl:flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Current Agent</h2>
        <p className="mt-1 text-xs text-slate-500">
          仅显示当前正在运行的 Agent 状态
        </p>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Run
          </p>
          <p className="mt-2 break-all text-xs text-slate-700">
            {currentRunId ?? "暂无运行中的请求"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Status: {currentRunStatus ?? "idle"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Active Agent
          </p>
          {currentAgent ? (
            <>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {toAgentLabel(currentAgent.agentName)}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                {currentAgent.phase}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {currentAgent.message}
              </p>
              {currentAgent.latencyMs || currentAgent.toolCount !== undefined ? (
                <p className="mt-3 text-xs text-slate-500">
                  {currentAgent.latencyMs
                    ? `Latency: ${currentAgent.latencyMs}ms`
                    : ""}
                  {currentAgent.latencyMs &&
                  currentAgent.toolCount !== undefined
                    ? " · "
                    : ""}
                  {currentAgent.toolCount !== undefined
                    ? `Tools: ${currentAgent.toolCount}`
                    : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              等待新的任务开始
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
