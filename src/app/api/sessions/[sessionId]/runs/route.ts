import { requireAuthContext } from "../../../../../lib/auth/context";
import { assertSameOrigin } from "../../../../../lib/auth/origin";
import { apiErrorResponse } from "../../../../../lib/api/errors";
import {
  sessionIdSchema,
  sessionRunBodySchema,
} from "../../../../../lib/api/schemas";
import {
  parseWithSchema,
  readJsonBody,
} from "../../../../../lib/api/validate";
import {
  resumeSessionRun,
  startSessionRun,
} from "../../../../../lib/api/session-runs";
import { listSessionRuns } from "../../../../../lib/db/tenant-access";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  try {
    const auth = await requireAuthContext(req);
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = parseWithSchema(sessionIdSchema, rawSessionId);
    const runs = await listSessionRuns(auth, sessionId);
    return Response.json({ runs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    assertSameOrigin(req);
    const auth = await requireAuthContext(req);
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = parseWithSchema(sessionIdSchema, rawSessionId);
    const body = parseWithSchema(sessionRunBodySchema, await readJsonBody(req));

    if (body.kind === "resume") {
      return await resumeSessionRun(auth, body, {
        expectedSessionId: sessionId,
      });
    }

    return await startSessionRun(auth, sessionId, body);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
