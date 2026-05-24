import { prisma } from "../db/client";

export async function listSessionRuns(sessionId: string) {
  return prisma.agentRun.findMany({
    where: {
      sessionId,
    },
    orderBy: {
      startedAt: "desc",
    },
    take: 20,
    select: {
      id: true,
      runtimeType: true,
      trigger: true,
      status: true,
      completionReason: true,
      latestUserTask: true,
      startedAt: true,
      finishedAt: true,
      latencyMs: true,
      _count: {
        select: {
          steps: true,
          modelCalls: true,
          toolCalls: true,
          interrupts: true,
          errorLogs: true,
        },
      },
    },
  });
}

export async function getRunTrace(runId: string) {
  return prisma.agentRun.findUnique({
    where: {
      id: runId,
    },
    include: {
      steps: {
        orderBy: {
          startedAt: "asc",
        },
      },
      modelCalls: {
        orderBy: {
          createdAt: "asc",
        },
      },
      toolCalls: {
        orderBy: {
          createdAt: "asc",
        },
      },
      interrupts: {
        orderBy: {
          createdAt: "asc",
        },
      },
      errorLogs: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });
}
