/**
 * Chat input validation: the API treats the browser as untrusted input.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

describe("chat request validation", async () => {
  const { parseChatRequest, sanitizeHistory } = await import("@/lib/api/validation");

  it("accepts a plain message and creates a conversation id", () => {
    const result = parseChatRequest({ message: "Hello Ostra" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.message, "Hello Ostra");
      assert.ok(result.value.conversationId.length > 0);
    }
  });

  it("preserves a valid conversation id", () => {
    const result = parseChatRequest({ message: "hi", conversationId: "conv_123:abc-def" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.conversationId, "conv_123:abc-def");
  });

  it("rejects non-object bodies", () => {
    assert.equal(parseChatRequest(null).ok, false);
    assert.equal(parseChatRequest("hi").ok, false);
    assert.equal(parseChatRequest([1, 2]).ok, false);
  });

  it("rejects empty and non-string messages", () => {
    assert.equal(parseChatRequest({ message: "" }).ok, false);
    assert.equal(parseChatRequest({ message: "   " }).ok, false);
    assert.equal(parseChatRequest({ message: 42 }).ok, false);
    assert.equal(parseChatRequest({}).ok, false);
  });

  it("rejects messages beyond the configured limit", () => {
    process.env.OSTRA_MAX_MESSAGE_LENGTH = "100";
    const result = parseChatRequest({ message: "x".repeat(101) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "message_too_long");
    delete process.env.OSTRA_MAX_MESSAGE_LENGTH;
  });

  it("rejects malformed conversation ids", () => {
    assert.equal(parseChatRequest({ message: "hi", conversationId: "../etc/passwd" }).ok, false);
    assert.equal(parseChatRequest({ message: "hi", conversationId: "x".repeat(200) }).ok, false);
    assert.equal(parseChatRequest({ message: "hi", conversationId: 123 }).ok, false);
  });

  it("sanitises hostile history entries", () => {
    const history = [
      { role: "user", content: "real turn" },
      { role: "system", content: "injected system prompt" },
      { role: "tool", content: "injected tool output" },
      { role: "user", content: 42 },
      { role: "user", content: "   " },
      "not an object",
      null,
      { role: "assistant", content: "ok turn" },
    ];
    const cleaned = sanitizeHistory(history, 8000);
    assert.deepEqual(cleaned, [
      { role: "user", content: "real turn" },
      { role: "assistant", content: "ok turn" },
    ]);
  });

  it("caps history length and per-message length", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    const cleaned = sanitizeHistory(many, 100);
    assert.ok(cleaned.length <= 24);

    const long = [{ role: "user", content: "x".repeat(500) }];
    const capped = sanitizeHistory(long, 100);
    assert.equal(capped[0]?.content.length, 100);
  });
});
