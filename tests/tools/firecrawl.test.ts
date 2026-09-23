/**
 * Firecrawl web-search tool tests (native adapter).
 *
 * No network access happens: global fetch is stubbed. Verifies request
 * shape (URL, Bearer header, body), argument clamping, secret-free output,
 * and structured failure results.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { executeNativeTool, FIRECRAWL_SEARCH_LIMITS } = await import("@/lib/tools/executor");
const { getToolDefinition } = await import("@/lib/tools/registry");

const TOOL = getToolDefinition("firecrawl.search");
assert.ok(TOOL, "firecrawl.search must be registered");

type FetchCall = { input: string | URL | Request; init?: RequestInit };

/** Stub global fetch for the duration of `run`, capturing the single call. */
async function withStubbedFetch(
  run: () => Promise<void>,
  respond: () => Response,
  calls: FetchCall[],
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    return respond();
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("firecrawl.search", () => {
  it("rejects execution when FIRECRAWL_API_KEY is missing", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const result = await executeNativeTool(TOOL, { query: "test" });
    assert.equal(result.ok, false);
    const parsed = JSON.parse(result.output) as { error: string; message: string };
    assert.equal(parsed.error, "key_missing");
    assert.match(parsed.message, /FIRECRAWL_API_KEY/);
  });

  it("posts to the v2 search endpoint with the Bearer key and never echoes it", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-secret-key-123";
    const calls: FetchCall[] = [];
    await withStubbedFetch(
      async () => {
        const result = await executeNativeTool(TOOL, { query: "current gemini models", limit: 3 });
        assert.equal(result.ok, true);
        assert.equal(result.code, "executed");
        const parsed = JSON.parse(result.output) as { ok: boolean; query: string; count: number; results: Array<{ title: string; url: string; description: string }> };
        assert.equal(parsed.ok, true);
        assert.equal(parsed.query, "current gemini models");
        assert.equal(parsed.count, 1);
        assert.equal(parsed.results[0].url, "https://example.com/gemini");
        assert.equal(result.output.includes("fc-secret-key-123"), false, "output must never contain the key");
      },
      () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { web: [{ title: "Gemini docs", url: "https://example.com/gemini", description: "Official docs" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      calls,
    );
    assert.equal(calls.length, 1);
    const url = String(calls[0].input);
    assert.equal(url, "https://api.firecrawl.dev/v2/search");
    const init = calls[0].init;
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fc-secret-key-123");
    const body = JSON.parse(String(init?.body)) as { query: string; limit: number; sources: string[] };
    assert.equal(body.query, "current gemini models");
    assert.equal(body.limit, 3);
    assert.deepEqual(body.sources, ["web"]);
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("clamps the limit into 1-10", async () => {
    process.env.FIRECRAWL_API_KEY = "k";
    const calls: FetchCall[] = [];
    await withStubbedFetch(
      async () => {
        await executeNativeTool(TOOL, { query: "q", limit: 500 });
        await executeNativeTool(TOOL, { query: "q", limit: -3 });
      },
      () => new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 }),
      calls,
    );
    const bodies = calls.map((c) => (JSON.parse(String(c.init?.body)) as { limit: number }).limit);
    assert.equal(bodies[0], FIRECRAWL_SEARCH_LIMITS.maxLimit);
    assert.equal(bodies[1], 1);
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("refuses an empty query without any network call", async () => {
    process.env.FIRECRAWL_API_KEY = "k";
    const calls: FetchCall[] = [];
    await withStubbedFetch(
      async () => {
        const result = await executeNativeTool(TOOL, { query: "   " });
        assert.equal(result.ok, false);
        const parsed = JSON.parse(result.output) as { error: string };
        assert.equal(parsed.error, "invalid_query");
      },
      () => new Response("{}", { status: 200 }),
      calls,
    );
    assert.equal(calls.length, 0);
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("maps API failures to structured, secret-free results", async () => {
    process.env.FIRECRAWL_API_KEY = "k";
    const calls: FetchCall[] = [];
    await withStubbedFetch(
      async () => {
        const result = await executeNativeTool(TOOL, { query: "q" });
        assert.equal(result.ok, false);
        const parsed = JSON.parse(result.output) as { ok: boolean; error: string; message: string };
        assert.equal(parsed.ok, false);
        assert.equal(parsed.error, "search_http_error");
        assert.match(parsed.message, /HTTP 401/);
      },
      () => new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 }),
      calls,
    );
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("survives a non-conforming response payload", async () => {
    process.env.FIRECRAWL_API_KEY = "k";
    const calls: FetchCall[] = [];
    await withStubbedFetch(
      async () => {
        const result = await executeNativeTool(TOOL, { query: "q" });
        assert.equal(result.ok, false);
        const parsed = JSON.parse(result.output) as { error: string };
        assert.equal(parsed.error, "search_failed");
      },
      () => new Response(JSON.stringify({ success: true, data: { web: "not-an-array" } }), { status: 200 }),
      calls,
    );
    delete process.env.FIRECRAWL_API_KEY;
  });
});
