import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE_NAME } from "./lib/auth/constants";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(AUTH_SESSION_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/select-tenant"],
};
