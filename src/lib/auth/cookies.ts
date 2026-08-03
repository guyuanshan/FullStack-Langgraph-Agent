import type { NextResponse } from "next/server";
import {
  ACTIVE_TENANT_COOKIE_NAME,
  AUTH_COOKIE_OPTIONS,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "./constants";

export function clearActiveTenantCookie(response: NextResponse) {
  response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, "", {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 0,
  });
}

export function setActiveTenantCookie(
  response: NextResponse,
  tenantId: string
) {
  response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, tenantId, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
}
