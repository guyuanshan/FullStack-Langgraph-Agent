import { requireAuthContext } from "../../../../../lib/auth/context";
import { assertSameOrigin } from "../../../../../lib/auth/origin";
import { apiErrorResponse } from "../../../../../lib/api/errors";
import { decidePatchProposal } from "../../../../../lib/api/patch-decisions";
import {
  patchDecisionBodySchema,
  proposalIdSchema,
} from "../../../../../lib/api/schemas";
import {
  parseWithSchema,
  readJsonBody,
} from "../../../../../lib/api/validate";

type RouteContext = {
  params: Promise<{ proposalId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  try {
    assertSameOrigin(req);
    const auth = await requireAuthContext(req);
    const { proposalId: rawProposalId } = await context.params;
    const proposalId = parseWithSchema(proposalIdSchema, rawProposalId);
    const body = parseWithSchema(
      patchDecisionBodySchema,
      await readJsonBody(req)
    );
    const result = await decidePatchProposal(auth, proposalId, body);
    return Response.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
