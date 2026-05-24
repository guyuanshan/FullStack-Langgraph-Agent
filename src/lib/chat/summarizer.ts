import {
  RECENT_MESSAGE_WINDOW,
  SUMMARY_TRIGGER_MESSAGE_COUNT,
} from "./constants";
import { type SessionMessage } from "./session-store";
import {
  archiveMessagesById,
  getMessageCount,
  getOldMessagesForSummary,
  getSessionSummary,
  updateSessionSummary,
} from "./summary-store";

const MAX_SECTION_ITEMS = 6;
const MAX_SUMMARY_LENGTH = 4000;

function compactContent(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

function isSkippableContent(content: string) {
  if (!content) {
    return true;
  }

  const lower = content.toLowerCase();

  if (lower.length < 6) {
    return true;
  }

  if (/^(你好|好的|收到|谢谢|hi|hello)[!,.~\s]*$/i.test(content)) {
    return true;
  }

  if ((content.startsWith("{") || content.startsWith("[")) && content.length > 200) {
    return true;
  }

  return false;
}

function toSummaryLine(message: SessionMessage) {
  if (typeof message.content !== "string") {
    return null;
  }

  const compact = compactContent(message.content);

  if (isSkippableContent(compact)) {
    return null;
  }

  return compact.slice(0, 280);
}

function pushUnique(target: string[], value: string | null) {
  if (!value || target.includes(value)) {
    return;
  }

  target.push(value);
}

function classifyMessages(messages: SessionMessage[]) {
  const userGoals: string[] = [];
  const projectState: string[] = [];
  const technicalDecisions: string[] = [];
  const completedSteps: string[] = [];
  const openTasks: string[] = [];

  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "unknown";
    const line = toSummaryLine(message);

    if (!line) {
      continue;
    }

    const lower = line.toLowerCase();

    if (
      role === "user" &&
      /(帮我|请|需要|开始|下一步|继续|实现|接入|完成|修改|运行|分析)/.test(line)
    ) {
      pushUnique(userGoals, line);
    }

    if (
      /(项目|当前|现在|状态|session|runtime|langgraph|mcp|browser|github|prisma|sqlite|postgres|checkpoint|summary)/i.test(
        line
      )
    ) {
      pushUnique(projectState, line);
    }

    if (/(保留|改成|使用|采用|接入|切换|限制|改为|replace|switch)/i.test(lower)) {
      pushUnique(technicalDecisions, line);
    }

    if (/(完成|成功|通过|已接入|已支持|已实现|已经)/.test(line)) {
      pushUnique(completedSteps, line);
    }

    if (
      role === "user" &&
      /(待做|未完成|还需要|后续|下一步|继续|验证|测试)/.test(line)
    ) {
      pushUnique(openTasks, line);
    }
  }

  return {
    userGoals,
    projectState,
    technicalDecisions,
    completedSteps,
    openTasks,
  };
}

function renderSection(title: string, items: string[]) {
  if (items.length === 0) {
    return null;
  }

  return [title, ...items.slice(-MAX_SECTION_ITEMS).map((item) => `- ${item}`)].join("\n");
}

export function summarizeConversationMemory(
  previousSummary: string | null | undefined,
  oldMessages: SessionMessage[]
) {
  const sections = classifyMessages(oldMessages);
  const nextBlocks = [
    renderSection("User goals", sections.userGoals),
    renderSection("Project state", sections.projectState),
    renderSection("Technical decisions", sections.technicalDecisions),
    renderSection("Completed steps", sections.completedSteps),
    renderSection("Open tasks", sections.openTasks),
  ].filter((block): block is string => !!block);

  if (nextBlocks.length === 0) {
    return previousSummary?.trim() || null;
  }

  const blocks = [];

  if (previousSummary?.trim()) {
    blocks.push(previousSummary.trim());
  }

  blocks.push(nextBlocks.join("\n\n"));

  return blocks.join("\n\n").slice(-MAX_SUMMARY_LENGTH);
}

export async function maybeSummarizeSession(sessionId: string) {
  const activeCount = await getMessageCount(sessionId, {
    archived: false,
  });

  if (activeCount <= SUMMARY_TRIGGER_MESSAGE_COUNT) {
    return {
      summarized: false,
      activeCount,
      archivedCount: 0,
      reason: "below-threshold",
    };
  }

  const oldMessages = await getOldMessagesForSummary(sessionId, {
    preserveRecent: RECENT_MESSAGE_WINDOW,
  });

  if (oldMessages.length === 0) {
    return {
      summarized: false,
      activeCount,
      archivedCount: 0,
      reason: "no-old-messages",
    };
  }

  const { summary: previousSummary } = await getSessionSummary(sessionId);
  const nextSummary = summarizeConversationMemory(
    previousSummary,
    oldMessages.map((entry) => entry.message)
  );

  await updateSessionSummary(sessionId, nextSummary);
  const archivedCount = await archiveMessagesById(oldMessages.map((entry) => entry.id));

  return {
    summarized: true,
    activeCount,
    archivedCount,
    summaryLength: nextSummary?.length ?? 0,
  };
}
