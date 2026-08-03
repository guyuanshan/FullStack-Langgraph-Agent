export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60;

// Production names use the "__Host-" prefix (requires Secure + Path=/ + no Domain).
// Better Auth's useSecureCookies must stay false so it does not also prepend "__Secure-".
export const AUTH_SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-fullstack-agent.session_token"
    : "fullstack-agent.session_token";

export const ACTIVE_TENANT_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-active_tenant"
    : "active_tenant";

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
