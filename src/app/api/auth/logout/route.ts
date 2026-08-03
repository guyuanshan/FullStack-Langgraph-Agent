import { NextResponse } from "next/server";
import { clearActiveTenantCookie } from "../../../../lib/auth/cookies";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { assertSameOrigin } from "../../../../lib/auth/origin";
import { auth } from "../../../../lib/auth/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);

    await auth.api.signOut({
      headers: request.headers,
    });

    const response = NextResponse.json({ success: true });
    clearActiveTenantCookie(response);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
