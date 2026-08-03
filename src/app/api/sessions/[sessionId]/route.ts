import { requireAuthContext } from "../../../../lib/auth/context";
import { assertSameOrigin } from "../../../../lib/auth/origin";
import { apiErrorResponse } from "../../../../lib/api/errors";
import { sessionIdSchema } from "../../../../lib/api/schemas";
import { parseWithSchema } from "../../../../lib/api/validate";
import {
  deleteSession,
  requireTenantSession,
} from "../../../../lib/db/tenant-access";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  try {
    const auth = await requireAuthContext(req);
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = parseWithSchema(sessionIdSchema, rawSessionId);
    const session = await requireTenantSession(auth, sessionId);
    return Response.json({ session });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    assertSameOrigin(req);
    const auth = await requireAuthContext(req);
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = parseWithSchema(sessionIdSchema, rawSessionId);
    await deleteSession(auth, sessionId);
    return Response.json({
      ok: true,
      deleted: true,
      sessionId,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
