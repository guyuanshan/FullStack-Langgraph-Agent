import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "../db/client";
import {
  AUTH_COOKIE_OPTIONS,
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_SESSION_UPDATE_AGE_SECONDS,
} from "./constants";

const DEVELOPMENT_AUTH_SECRET =
  "development-only-auth-secret-change-before-production";

function resolveAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production.");
  }

  return DEVELOPMENT_AUTH_SECRET;
}

function resolveAuthBaseUrl() {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim();

  if (baseUrl) {
    return baseUrl;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_URL is required in production.");
  }

  return "http://localhost:3000";
}

export const auth = betterAuth({
  appName: "Fullstack LangGraph Agent",
  secret: resolveAuthSecret(),
  baseURL: resolveAuthBaseUrl(),
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  user: {
    modelName: "User",
  },
  session: {
    modelName: "AuthSession",
    expiresIn: AUTH_SESSION_MAX_AGE_SECONDS,
    updateAge: AUTH_SESSION_UPDATE_AGE_SECONDS,
    cookieCache: {
      enabled: false,
    },
  },
  account: {
    modelName: "AuthAccount",
  },
  verification: {
    modelName: "AuthVerification",
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
  advanced: {
    // Keep false so Better Auth does not prepend "__Secure-" on top of our
    // explicit "__Host-" cookie names. Production Secure/HttpOnly/SameSite
    // attributes still come from AUTH_COOKIE_OPTIONS.
    useSecureCookies: false,
    disableCSRFCheck: false,
    disableOriginCheck: false,
    cookiePrefix: "fullstack-agent",
    defaultCookieAttributes: AUTH_COOKIE_OPTIONS,
    cookies: {
      session_token: {
        name: AUTH_SESSION_COOKIE_NAME,
        attributes: AUTH_COOKIE_OPTIONS,
      },
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
