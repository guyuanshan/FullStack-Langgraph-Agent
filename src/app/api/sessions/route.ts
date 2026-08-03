import { requireAuthContext } from "../../../lib/auth/context";
import { assertSameOrigin } from "../../../lib/auth/origin";
import { apiErrorResponse } from "../../../lib/api/errors";
import { createSessionBodySchema } from "../../../lib/api/schemas";
import {
  parseWithSchema,
  readJsonBody,
} from "../../../lib/api/validate";
import {
  assertCanCreateSession,
  ensureTenantSession,
  listSessions,
} from "../../../lib/db/tenant-access";

export async function GET(req: Request) {
  try {
    const auth = await requireAuthContext(req);
    const sessions = await listSessions(auth);
    return Response.json({ sessions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const auth = await requireAuthContext(req);
    assertCanCreateSession(auth);
    const body = parseWithSchema(createSessionBodySchema, await readJsonBody(req));
    const sessionId = body.id ?? crypto.randomUUID();
    const session = await ensureTenantSession(auth, sessionId);
    return Response.json({
      session: {
        id: session.id,
        tenantId: session.tenantId,
        userId: session.userId,
        title: session.title,
        createdAt: session.createdAt,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
