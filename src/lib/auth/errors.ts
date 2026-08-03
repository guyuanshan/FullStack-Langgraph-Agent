import { NextResponse } from "next/server";
import { clearActiveTenantCookie } from "./cookies";
import {
  AuthContextError,
  isAuthContextError,
  type AuthErrorCode,
} from "./error-types";

export type { AuthErrorCode };
export { AuthContextError, isAuthContextError };

function logAuthFailure(input: {
  code: string;
  status: number;
  userId?: string;
}) {
  console.info(
    JSON.stringify({
      event: "auth_context_failed",
      code: input.code,
      status: input.status,
      userId: input.userId ?? null,
    })
  );
}

export function authErrorResponse(error: unknown, userId?: string) {
  if (!isAuthContextError(error)) {
    console.error(
      JSON.stringify({
        event: "auth_context_failed",
        code: "AUTH_CONTEXT_FAILED",
        status: 500,
        userId: userId ?? null,
      })
    );

    return NextResponse.json(
      {
        error: "AUTH_CONTEXT_FAILED",
        message: "Unable to resolve the authentication context.",
      },
      { status: 500 }
    );
  }

  logAuthFailure({
    code: error.code,
    status: error.status,
    userId,
  });

  const response = NextResponse.json(
    {
      error: error.code,
      message: error.message,
    },
    { status: error.status }
  );

  if (error.code === "INVALID_TENANT_MEMBERSHIP") {
    clearActiveTenantCookie(response);
  }

  return response;
}
