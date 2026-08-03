import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthContextError } from "./error-types";
import { assertSameOrigin } from "./origin";

function makeRequest(input: {
  url: string;
  origin?: string | null;
  host?: string | null;
}) {
  const headers = new Headers();

  if (input.origin) {
    headers.set("origin", input.origin);
  }

  if (input.host) {
    headers.set("host", input.host);
  }

  return new Request(input.url, {
    method: "POST",
    headers,
  });
}

describe("assertSameOrigin", () => {
  it("accepts matching same-origin requests", () => {
    assert.doesNotThrow(() =>
      assertSameOrigin(
        makeRequest({
          url: "http://localhost:3000/api/chat",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        })
      )
    );
  });

  it("rejects cross-site origins", () => {
    assert.throws(
      () =>
        assertSameOrigin(
          makeRequest({
            url: "http://localhost:3000/api/chat",
            origin: "https://evil.example",
            host: "localhost:3000",
          })
        ),
      (error: unknown) =>
        error instanceof AuthContextError &&
        error.code === "FORBIDDEN_ORIGIN" &&
        error.status === 403
    );
  });

  it("rejects missing origin or host headers", () => {
    assert.throws(
      () =>
        assertSameOrigin(
          makeRequest({
            url: "http://localhost:3000/api/chat",
            host: "localhost:3000",
          })
        ),
      (error: unknown) =>
        error instanceof AuthContextError && error.code === "FORBIDDEN_ORIGIN"
    );
  });
});
