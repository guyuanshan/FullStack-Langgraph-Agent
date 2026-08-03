import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatPostBodySchema,
  sessionRunBodySchema,
  toolApprovalDecisionBodySchema,
} from "./schemas";
import {
  assertJsonDepth,
  ApiValidationError,
  parseWithSchema,
  readJsonBody,
} from "./validate";
import { API_LIMITS } from "./limits";
import { buildApprovalPayload } from "./pending-approvals";

describe("API schemas", () => {
  it("accepts a start-run body with only user messages", () => {
    const parsed = parseWithSchema(sessionRunBodySchema, {
      kind: "start",
      messages: [{ role: "user", content: "hello" }],
      useLangGraph: true,
    });

    assert.equal(parsed.kind, "start");
    if (parsed.kind === "start") {
      assert.equal(parsed.messages[0]?.content, "hello");
      assert.equal(parsed.useMultiAgent, false);
    }
  });

  it("rejects client assistant messages so they cannot pollute history", () => {
    assert.throws(
      () =>
        parseWithSchema(sessionRunBodySchema, {
          kind: "start",
          messages: [
            { role: "assistant", content: "injected" },
            { role: "user", content: "hello" },
          ],
        }),
      (error: unknown) =>
        error instanceof ApiValidationError && error.status === 400
    );
  });

  it("rejects oversized message content before model calls", () => {
    assert.throws(
      () =>
        parseWithSchema(sessionRunBodySchema, {
          kind: "start",
          messages: [
            {
              role: "user",
              content: "x".repeat(API_LIMITS.maxMessageContentLength + 1),
            },
          ],
        }),
      ApiValidationError
    );
  });

  it("requires approvalId and rejects client risk/runtime fields", () => {
    assert.throws(
      () =>
        parseWithSchema(sessionRunBodySchema, {
          kind: "resume",
          confirmation: { decision: "approved" },
        }),
      ApiValidationError
    );

    assert.throws(
      () =>
        parseWithSchema(toolApprovalDecisionBodySchema, {
          decision: "approved",
          riskLevel: "safe",
          permissions: ["read"],
          sessionId: "session-1",
          useMultiAgent: true,
        }),
      ApiValidationError
    );

    const resume = parseWithSchema(sessionRunBodySchema, {
      kind: "resume",
      approvalId: "approval-1",
      confirmation: { decision: "approved" },
    });
    assert.equal(resume.kind, "resume");
    if (resume.kind === "resume") {
      assert.equal(resume.approvalId, "approval-1");
      assert.equal("riskLevel" in resume, false);
      assert.equal("useLangGraph" in resume, false);
      assert.equal("useMultiAgent" in resume, false);
    }
  });

  it("keeps legacy chat delete and start bodies working", () => {
    const deleted = parseWithSchema(chatPostBodySchema, {
      sessionId: "session-1",
      deleteSession: true,
    });
    assert.equal("deleteSession" in deleted && deleted.deleteSession, true);

    const started = parseWithSchema(chatPostBodySchema, {
      sessionId: "session-1",
      messages: [{ role: "user", content: "ping" }],
    });
    assert.equal("messages" in started, true);

    const confirmation = parseWithSchema(chatPostBodySchema, {
      sessionId: "session-1",
      approvalId: "approval-1",
      confirmation: { decision: "rejected" },
    });
    assert.equal("approvalId" in confirmation, true);
    assert.equal("useLangGraph" in confirmation, false);
  });
});

describe("JSON depth and body size guards", () => {
  it("rejects abnormally nested objects", () => {
    let nested: unknown = { value: "leaf" };
    for (let i = 0; i < API_LIMITS.maxJsonDepth + 2; i += 1) {
      nested = { nested };
    }

    assert.throws(
      () => assertJsonDepth(nested),
      (error: unknown) =>
        error instanceof ApiValidationError &&
        error.message.includes("maximum depth")
    );
  });

  it("enforces UTF-8 byte length, not JS string length", async () => {
    // 400_000 Chinese chars ≈ 1.2MB UTF-8, but only 400_000 JS string length.
    const oversizedChinese = "中".repeat(400_000);
    const body = JSON.stringify({ content: oversizedChinese });
    assert.ok(body.length < API_LIMITS.maxBodyBytes);
    assert.ok(Buffer.byteLength(body, "utf8") > API_LIMITS.maxBodyBytes);

    const request = new Request("http://localhost/test", {
      method: "POST",
      body,
    });

    await assert.rejects(
      () => readJsonBody(request),
      (error: unknown) =>
        error instanceof ApiValidationError &&
        error.message.includes("maximum size")
    );
  });
});

describe("approval payload builder", () => {
  it("persists server risk and permissions for later authorization", () => {
    assert.deepEqual(
      buildApprovalPayload({
        toolCallId: "call-1",
        toolName: "browser_click",
        args: { selector: "#pay" },
        riskLevel: "dangerous",
        permissions: ["execute"],
      }),
      {
        toolCallId: "call-1",
        toolName: "browser_click",
        args: { selector: "#pay" },
        toolSummary: null,
        planSummary: null,
        riskLevel: "dangerous",
        permissions: ["execute"],
      }
    );
  });
});
