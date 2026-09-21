/**
 * Tool registry tests (Stage 2).
 *
 * Covers: valid tool lookup, unknown tool, disabled tools, schema validity,
 * permission invariants, and registry honesty (Vercel Connect tools must
 * require authentication; OpenRouter tools must not pretend execution).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { getToolDefinition, listToolDefinitions, isToolAllowed, TOOL_REGISTRY } = await import("@/lib/tools/registry");
const { TOOL_PERMISSIONS } = await import("@/lib/tools/types");
const { validateToolArgs } = await import("@/lib/tools/validate-args");

describe("tool registry", () => {
  it("contains the OpenRouter server tools", () => {
    for (const id of ["openrouter:web_search", "openrouter:web_fetch", "openrouter:datetime", "openrouter:shell", "openrouter:image_generation"]) {
      assert.ok(isToolAllowed(id), `${id} should be registered`);
    }
  });

  it("registers a native noop tool for pipeline verification", () => {
    const tool = getToolDefinition("ostra:noop");
    assert.ok(tool);
    assert.equal(tool.executionType, "native");
    assert.equal(tool.enabled, true);
  });

  it("registers Vercel Connect tools with authentication required", () => {
    const github = getToolDefinition("connect:github");
    assert.ok(github);
    assert.equal(github.provider, "vercel-connect");
    assert.equal(github.requiresAuthentication, true);

    const stripe = getToolDefinition("connect:stripe");
    assert.ok(stripe);
    assert.equal(stripe.permission, "financial");
    assert.equal(stripe.requiresApproval, true);
    assert.equal(stripe.enabled, false, "tier-2 tools start disabled");
  });

  it("keeps every tool's schema a JSON-Schema object", () => {
    for (const tool of TOOL_REGISTRY) {
      assert.equal(typeof tool.inputSchema, "object");
      assert.notEqual(tool.inputSchema, null);
      assert.equal((tool.inputSchema as Record<string, unknown>).type, "object");
    }
  });

  it("orders the permission ladder exactly as specified", () => {
    assert.deepEqual([...TOOL_PERMISSIONS], ["read", "write", "execute", "external_action", "financial", "destructive"]);
  });

  it("enables exactly the tier-1 connect integrations", () => {
    const enabledConnect = TOOL_REGISTRY.filter((t) => t.provider === "vercel-connect" && t.enabled).map((t) => t.id);
    assert.deepEqual(
      enabledConnect.sort(),
      [
        "connect:agentmail",
        "connect:cloudflare",
        "connect:firecrawl",
        "connect:github",
        "connect:google",
        "connect:mem0",
        "connect:notion",
        "connect:slack",
        "connect:supabase",
        "connect:telegram-bot",
        "connect:vercel",
        "connect:zapier",
      ],
    );
  });

  it("treats high-risk tools as approval-gated by default", () => {
    const shell = getToolDefinition("openrouter:shell");
    assert.equal(shell?.requiresApproval, true);
    const payment = getToolDefinition("connect:paypal");
    assert.equal(payment?.requiresApproval, true);
  });

  it("exposes read-only OpenRouter research tools without approval", () => {
    const search = getToolDefinition("openrouter:web_search");
    assert.equal(search?.permission, "read");
    assert.equal(search?.requiresApproval, false);
    assert.equal(search?.requiresAuthentication, false);
  });

  it("lists every tool once (no duplicate ids)", () => {
    const ids = listToolDefinitions().map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("tool argument validation", () => {
  it("accepts valid args against the registry schema", () => {
    const tool = getToolDefinition("openrouter:web_fetch")!;
    const result = validateToolArgs(tool.id, tool.inputSchema, { url: "https://example.com" });
    assert.ok(result.ok);
  });

  it("rejects unknown properties (strict object)", () => {
    const tool = getToolDefinition("openrouter:web_fetch")!;
    const result = validateToolArgs(tool.id, tool.inputSchema, { url: "https://example.com", evil: "x" });
    assert.equal(result.ok, false);
  });

  it("rejects missing required args", () => {
    const tool = getToolDefinition("openrouter:web_fetch")!;
    const result = validateToolArgs(tool.id, tool.inputSchema, {});
    assert.equal(result.ok, false);
  });

  it("rejects args for a schema that cannot be enforced", () => {
    const result = validateToolArgs("test", { type: "banana" }, { a: 1 });
    assert.ok(!result.ok && result.code === "invalid_schema");
  });

  it("rejects non-object args", () => {
    const tool = getToolDefinition("openrouter:web_search")!;
    const result = validateToolArgs(tool.id, tool.inputSchema, "not-an-object");
    assert.ok(!result.ok && result.code === "invalid_args");
  });
});
