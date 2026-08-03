export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_ORIGIN"
  | "NO_TENANT_MEMBERSHIP"
  | "INVALID_TENANT_MEMBERSHIP"
  | "TENANT_SELECTION_REQUIRED";

const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN_ORIGIN: "The request origin is not allowed.",
  NO_TENANT_MEMBERSHIP: "The user does not belong to an active tenant.",
  INVALID_TENANT_MEMBERSHIP:
    "The selected tenant is unavailable for the current user.",
  TENANT_SELECTION_REQUIRED: "Select a tenant before continuing.",
};

export class AuthContextError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: 401 | 403 | 409
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "AuthContextError";
  }
}

export function isAuthContextError(error: unknown): error is AuthContextError {
  return error instanceof AuthContextError;
}
