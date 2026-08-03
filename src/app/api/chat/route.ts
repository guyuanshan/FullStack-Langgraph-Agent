import { requireAuthContext } from "../../../lib/auth/context";
import { assertSameOrigin } from "../../../lib/auth/origin";
import { apiErrorResponse } from "../../../lib/api/errors";
import {
  chatGetQuerySchema,
  chatPostBodySchema,
} from "../../../lib/api/schemas";
import { decidePatchProposal } from "../../../lib/api/patch-decisions";
import {
  loadSessionMessages,
  resumeSessionRun,
  startSessionRun,
} from "../../../lib/api/session-runs";
import {
  parseWithSchema,
  readJsonBody,
} from "../../../lib/api/validate";
import {
  deleteSession,
  getRunTrace,
  listSessionRuns,
  listSessions,
} from "../../../lib/db/tenant-access";

/**
 * @deprecated Prefer the split REST routes under `/api/sessions`, `/api/runs`,
 * `/api/patch-proposals`, and `/api/tool-approvals`. Kept as a validated
 * compatibility shim during the P4.4 migration.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAuthContext(req);
    const { searchParams } = new URL(req.url);
    const query = parseWithSchema(
      chatGetQuerySchema,
      Object.fromEntries(searchParams.entries())
    );

    if (query.includeSessions) {
      return Response.json({
        sessions: await listSessions(auth),
      });
    }

    if (query.includeRuns) {
      return Response.json({
        runs: await listSessionRuns(auth, query.sessionId!),
      });
    }

    if (query.includeTrace) {
      return Response.json({
        trace: await getRunTrace(auth, query.runId!),
      });
    }

    return Response.json(
      await loadSessionMessages(auth, query.sessionId!, {
        useLangGraph: query.useLangGraph,
      })
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const auth = await requireAuthContext(req);
    const body = parseWithSchema(chatPostBodySchema, await readJsonBody(req));

    if ("deleteSession" in body && body.deleteSession) {
      await deleteSession(auth, body.sessionId);
      return Response.json({
        ok: true,
        deleted: true,
        sessionId: body.sessionId,
      });
    }

    if ("confirmation" in body && body.confirmation) {
      return await resumeSessionRun(
        auth,
        {
          approvalId: body.approvalId,
          confirmation: body.confirmation,
        },
        {
          entrypoint: "/api/chat",
          expectedSessionId: body.sessionId,
        }
      );
    }

    if ("patchAction" in body && body.patchAction) {
      const result = await decidePatchProposal(
        auth,
        body.patchAction.proposalId,
        {
          action: body.patchAction.action,
          reason: body.patchAction.reason,
          files: body.patchAction.files,
        }
      );
      return Response.json(result);
    }

    if ("messages" in body && body.messages) {
      return await startSessionRun(
        auth,
        body.sessionId,
        {
          kind: "start",
          messages: body.messages,
          useLangGraph: body.useLangGraph,
          useMultiAgent: body.useMultiAgent,
        },
        { entrypoint: "/api/chat" }
      );
    }

    return Response.json(
      {
        error: "VALIDATION_ERROR",
        message: "Unrecognized chat request.",
      },
      { status: 400 }
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
