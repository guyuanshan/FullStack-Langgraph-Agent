import { AuthContextError } from "./error-types";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    throw new AuthContextError("FORBIDDEN_ORIGIN", 403);
  }

  let originUrl: URL;

  try {
    originUrl = new URL(origin);
  } catch {
    throw new AuthContextError("FORBIDDEN_ORIGIN", 403);
  }

  const requestUrl = new URL(request.url);

  if (originUrl.host !== host || originUrl.protocol !== requestUrl.protocol) {
    throw new AuthContextError("FORBIDDEN_ORIGIN", 403);
  }
}
