import { requireAuthContext } from "../../../../../lib/auth/context";
import { apiErrorResponse } from "../../../../../lib/api/errors";
import {
  sessionIdSchema,
  sessionMessagesQuerySchema,
} from "../../../../../lib/api/schemas";
import { parseWithSchema } from "../../../../../lib/api/validate";
import { loadSessionMessages } from "../../../../../lib/api/session-runs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  try {
    const auth = await requireAuthContext(req);
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = parseWithSchema(sessionIdSchema, rawSessionId);
    const { searchParams } = new URL(req.url);
    const query = parseWithSchema(
      sessionMessagesQuerySchema,
      Object.fromEntries(searchParams.entries())
    );

    const payload = await loadSessionMessages(auth, sessionId, {
      useLangGraph: query.useLangGraph,
    });

    return Response.json(payload);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
