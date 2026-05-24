import type { AgentRole, AgentTaskKind, PlannerOutput } from "./types";

const BROWSER_PATTERNS = [
  "浏览器",
  "网页",
  "文档",
  "官网",
  "search",
  "查资料",
  "打开",
  "链接",
];

const BUG_FIX_PATTERNS = [
  "bug",
  "报错",
  "修复",
  "fix",
  "typecheck",
  "lint",
  "test",
];

const PR_PATTERNS = ["pr", "pull request", "commit", "branch", "summary"];

const PLAN_APPROVAL_PATTERNS = [
  "修改",
  "修复",
  "写入",
  "删除",
  "提交",
  "commit",
  "branch",
  "pr",
  "issue",
  "patch",
  "apply",
  "创建",
];

const CODE_PATTERNS = [
  "代码",
  "组件",
  "route",
  "tool",
  "patch",
  "修改",
  "分析项目",
  "项目结构",
  "技术栈",
  "架构",
];

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function matchesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function classifyTaskKind(input: string): AgentTaskKind {
  const text = normalize(input);

  if (matchesAny(text, BUG_FIX_PATTERNS)) {
    return "bug_fix";
  }

  if (matchesAny(text, BROWSER_PATTERNS)) {
    return "documentation_research";
  }

  if (matchesAny(text, PR_PATTERNS)) {
    return "pr_summary";
  }

  if (matchesAny(text, CODE_PATTERNS)) {
    return "code_change";
  }

  return "general";
}

export function getPrimaryExecutionAgent(
  taskKind: AgentTaskKind
): Extract<AgentRole, "code" | "browser" | "tool_executor"> {
  if (taskKind === "documentation_research") {
    return "browser";
  }

  if (taskKind === "general") {
    return "tool_executor";
  }

  return "code";
}

export function createFallbackPlan(task: string): PlannerOutput {
  const taskKind = classifyTaskKind(task);
  const primaryAgent = getPrimaryExecutionAgent(taskKind);
  const requiresPlanApproval = shouldRequirePlanApproval(task, taskKind);

  return {
    goal: task,
    complexity: requiresPlanApproval ? "high" : "medium",
    primaryAgent,
    requiresPlanApproval,
    steps: [
      {
        id: "plan-1",
        title: "Understand the task and gather relevant context",
        agent: primaryAgent,
        objective: "Collect the files, tools, or web context needed to execute the request safely.",
      },
      {
        id: "plan-2",
        title: "Execute the task",
        agent: primaryAgent,
        objective: task,
      },
      {
        id: "plan-3",
        title: "Review the result",
        agent: "reviewer",
        objective: "Check correctness, risks, regressions, and missing validation.",
      },
    ],
  };
}

export function shouldRequirePlanApproval(
  task: string,
  taskKind: AgentTaskKind
) {
  const text = normalize(task);

  if (matchesAny(text, PLAN_APPROVAL_PATTERNS)) {
    return true;
  }

  return taskKind === "bug_fix" || taskKind === "pr_summary";
}

export function filterToolNamesForAgent(role: AgentRole) {
  if (role === "browser") {
    return (toolName: string) =>
      toolName.startsWith("browser_") || toolName === "project_memory_search";
  }

  if (role === "code") {
    return (toolName: string) =>
      toolName.startsWith("project_") ||
      toolName === "code_propose_patch" ||
      toolName === "run_project_checks" ||
      toolName.startsWith("git_") ||
      toolName.startsWith("fs_") ||
      toolName.startsWith("github_");
  }

  if (role === "tool_executor") {
    return () => true;
  }

  return () => false;
}
