import { ZodError, type ZodType } from "zod";
import { API_LIMITS } from "./limits";

export class ApiValidationError extends Error {
  constructor(
    readonly status: 400,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

export function isApiValidationError(
  error: unknown
): error is ApiValidationError {
  return error instanceof ApiValidationError;
}

export function validationErrorResponse(error: ApiValidationError) {
  return Response.json(
    {
      error: "VALIDATION_ERROR",
      message: error.message,
      details: error.details ?? null,
    },
    { status: error.status }
  );
}

export function assertJsonDepth(
  value: unknown,
  maxDepth = API_LIMITS.maxJsonDepth,
  depth = 0
) {
  if (depth > maxDepth) {
    throw new ApiValidationError(
      400,
      `JSON nesting exceeds the maximum depth of ${maxDepth}.`
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonDepth(item, maxDepth, depth + 1);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      assertJsonDepth(nested, maxDepth, depth + 1);
    }
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");

  if (contentLength) {
    const size = Number(contentLength);

    if (Number.isFinite(size) && size > API_LIMITS.maxBodyBytes) {
      throw new ApiValidationError(
        400,
        `Request body exceeds the maximum size of ${API_LIMITS.maxBodyBytes} bytes.`
      );
    }
  }

  let bodyBytes: Buffer;

  try {
    bodyBytes = Buffer.from(await request.arrayBuffer());
  } catch {
    throw new ApiValidationError(400, "Unable to read request body.");
  }

  if (bodyBytes.byteLength > API_LIMITS.maxBodyBytes) {
    throw new ApiValidationError(
      400,
      `Request body exceeds the maximum size of ${API_LIMITS.maxBodyBytes} bytes.`
    );
  }

  const raw = bodyBytes.toString("utf8");

  if (raw.trim() === "") {
    throw new ApiValidationError(400, "Request body must be valid JSON.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiValidationError(400, "Request body must be valid JSON.");
  }

  assertJsonDepth(parsed);
  return parsed;
}

export function parseWithSchema<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new ApiValidationError(
      400,
      "Request validation failed.",
      formatZodError(result.error)
    );
  }

  return result.data;
}

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}
