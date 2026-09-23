/**
 * Gateway tool-attachment tests (Stage 2).
 *
 * Ensures validated tool attachments reach the OpenAI-compatible request
 * body correctly and cap the step budget — without any network access.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const originalFetch = globalThis.fetch;

function withFetchStub(stub: (input: string | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = stub as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("gateway tool attachments", () => {
  it("includes tools and max_tool_calls in the request body for OpenRouter", async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "nvidia/nemotron-3.5-lightning:free";
    process.env.OPENROUTER_API_KEY = "sk-test-secret-xyz";
    const { resetProviderConfig } = await import("@/lib/providers/config");
    const { callProvider } = await import("@/lib/providers/gateway");
    resetProviderConfig();

    const captured: { body: Record<string, unknown> | null } = { body: null };
    withFetchStub(async (_input, init) => {
      captured.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 } });
    });

    await callProvider([{ role: "user", content: "hi" }], {
      tools: [{ type: "openrouter:web_search" }, { type: "openrouter:datetime" }],
      maxToolCalls: 7,
    });

    assert.ok(captured.body);
    assert.deepEqual(captured.body.tools, [{ type: "openrouter:web_search" }, { type: "openrouter:datetime" }]);
    assert.equal(captured.body.max_tool_calls, 7);
    // Authorization goes in headers, never in the body:
    assert.equal(JSON.stringify(captured.body).includes("sk-test-secret-xyz"), false);
  });

  it("omits tools when none are attached", async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "nvidia/nemotron-3.5-lightning:free";
    process.env.OPENROUTER_API_KEY = "sk-test-secret-xyz";
    const { resetProviderConfig } = await import("@/lib/providers/config");
    const { callProvider } = await import("@/lib/providers/gateway");
    resetProviderConfig();

    const captured: { body: Record<string, unknown> | null } = { body: null };
    withFetchStub(async (_input, init) => {
      captured.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });

    await callProvider([{ role: "user", content: "hi" }], {});
    assert.ok(captured.body);
    assert.equal("tools" in captured.body, false);
    assert.equal("max_tool_calls" in captured.body, false);
  });

  it("clamps max_tool_calls to the API maximum of 30", async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "nvidia/nemotron-3.5-lightning:free";
    process.env.OPENROUTER_API_KEY = "sk-test-secret-xyz";
    const { resetProviderConfig } = await import("@/lib/providers/config");
    const { callProvider } = await import("@/lib/providers/gateway");
    resetProviderConfig();

    const captured: { body: Record<string, unknown> | null } = { body: null };
    withFetchStub(async (_input, init) => {
      captured.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });

    await callProvider([{ role: "user", content: "hi" }], {
      tools: [{ type: "openrouter:web_search" }],
      maxToolCalls: 500,
    });
    assert.equal(captured.body?.max_tool_calls, 30);
  });
});
