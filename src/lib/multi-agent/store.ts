import { prisma } from "../db/client";
import { resolveWriteTenantId } from "../db/tenant";
import type { AgentObservation, AgentTaskKind } from "./types";

export async function appendAgentTrace(
  sessionId: string,
  traceGroupId: string,
  taskKind: AgentTaskKind,
  observation: AgentObservation
) {
  const tenantId = await resolveWriteTenantId({ sessionId });

  await prisma.agentTrace.create({
    data: {
      id: observation.id,
      tenantId,
      sessionId,
      traceGroupId,
      agentName: observation.agent,
      phase: observation.phase,
      taskKind,
      message: observation.message,
      latencyMs: observation.latencyMs ?? null,
      toolCount: observation.toolCount ?? null,
      detailJson: JSON.stringify({
        createdAt: observation.createdAt,
      }),
    },
  });
}
