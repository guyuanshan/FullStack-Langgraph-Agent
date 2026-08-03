import { requireAuthContext } from "../../../../../lib/auth/context";
import { assertSameOrigin } from "../../../../../lib/auth/origin";
import { apiErrorResponse } from "../../../../../lib/api/errors";
import { resumeSessionRun } from "../../../../../lib/api/session-runs";
import {
  approvalIdSchema,
  toolApprovalDecisionBodySchema,
} from "../../../../../lib/api/schemas";
import {
  parseWithSchema,
  readJsonBody,
} from "../../../../../lib/api/validate";

type RouteContext = {
  params: Promise<{ approvalId: string }>;
};

/**
 * Decide a pending interrupt-backed approval.
 * approvalId is the InterruptEvent id; risk/runtime come from the server record.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    assertSameOrigin(req);
    const auth = await requireAuthContext(req);
    const { approvalId: rawApprovalId } = await context.params;
    const approvalId = parseWithSchema(approvalIdSchema, rawApprovalId);
    const body = parseWithSchema(
      toolApprovalDecisionBodySchema,
      await readJsonBody(req)
    );

    return await resumeSessionRun(
      auth,
      {
        approvalId,
        confirmation: {
          decision: body.decision,
          reason: body.reason,
        },
      },
      { entrypoint: "/api/tool-approvals/:approvalId/decision" }
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
