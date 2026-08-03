import { requireAuthContext } from "../../../../../lib/auth/context";
import { apiErrorResponse } from "../../../../../lib/api/errors";
import { runIdSchema } from "../../../../../lib/api/schemas";
import { parseWithSchema } from "../../../../../lib/api/validate";
import { getRunTrace } from "../../../../../lib/db/tenant-access";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  try {
    const auth = await requireAuthContext(req);
    const { runId: rawRunId } = await context.params;
    const runId = parseWithSchema(runIdSchema, rawRunId);
    const trace = await getRunTrace(auth, runId);
    return Response.json({ trace });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
