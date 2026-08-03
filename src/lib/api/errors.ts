import "server-only";

import type { AuthContext } from "../auth/context";
import {
  isApiValidationError,
  validationErrorResponse,
} from "./validate";
import {
  isTenantAccessError,
  tenantAccessErrorResponse,
} from "../db/tenant-access";
import { authErrorResponse } from "../auth/errors";

export function apiErrorResponse(error: unknown) {
  if (isApiValidationError(error)) {
    return validationErrorResponse(error);
  }

  if (isTenantAccessError(error)) {
    return tenantAccessErrorResponse(error);
  }

  return authErrorResponse(error);
}
