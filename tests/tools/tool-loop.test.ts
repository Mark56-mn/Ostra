/**
 * Stage 1 tests — tool registry, datetime tool, tool pipeline, malformed tool
 * calls, and the native web-fetch URL safety (no network).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getToolDefinition } from "@/lib/tools/registry";
import { executeTool, ToolError } from "@/lib/tools/service";
import { executeNativeTool, validateFetchUrl, WEB_FETCH_LIMITS } from "@/lib/tools/executor";
import { resolveAutoTools } from "@/lib/tools/chat-attach";
import { checkModelToolCompatibility } from "@/lib/tools/compatibility";
import { toolConfigStore } from "@/lib/tools/config";

// ---------------------------------------------------------------------------
// 1–2. Normal chat + model selection regression: covered by API tests below
// ---------------------------------------------------------------------------

describe("tool registry — task tools", () => {
  it("registers the datetime tool as native, read, enabled", () => {
    const tool = getToolDefinition("ostra:datetime");
    assert.ok(tool, "datetime must be registered");
    assert.equal(tool.executionType, "native");
    assert.equal(tool.enabled, true);
    assert.equal(tool.permission, "read");
    assert.equal(tool.requiresApproval, false);
  });

  it("registers the native web fetch tool with a URL schema", () => {
    const tool = getToolDefinition("ostra:web_fetch");
    assert.ok(tool, "ostra:web_fetch must be registered");
    assert.equal(tool.executionType, "native");
    assert.equal(tool.enabled, true);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ["url"]);
  });
});

describe("datetime tool", () => {
  it("returns reliable current time", () => {
    const tool = getToolDefinition("ostra:datetime");
    assert.ok(tool);
    const before = Date.now() - 50;
    const result = executeNativeTool(tool, {});
    return result.then((r) => {
      const after = Date.now() + 50;
      assert.equal(r.ok, true);
      const parsed = JSON.parse(r.output) as { iso_utc: string; epoch_ms: number };
      assert.ok(parsed.iso_utc.endsWith("Z"));
      assert.ok(parsed.epoch_ms >= before && parsed.epoch_ms <= after, "epoch must be current");
    });
  });

  it("executes through the full pipeline as the model would", async () => {
    const result = await executeTool("ostra:datetime", {}, { userApproved: false });
    assert.equal(result.state, "executed");
    const parsed = JSON.parse(result.output ?? "{}") as { iso_utc?: string };
    assert.ok(parsed.iso_utc, "pipeline output must be JSON with iso_utc");
  });
});

describe("auto-attach — provider capability gating", () => {
  it("gives tool-calling models the native tools", () => {
    const resolved = resolveAutoTools("gemini", "gemini-2.5-flash");
    assert.ok(resolved.functionTools.some((t) => t.toolId === "ostra:datetime"));
    assert.ok(resolved.functionTools.some((t) => t.toolId === "ostra:web_fetch"));
    assert.equal(resolved.serverTools.length, 0, "non-OpenRouter providers get no server tools");
  });

  it("adds OpenRouter server tools only for OpenRouter models", () => {
    const resolved = resolveAutoTools("openrouter", "nvidia/nemotron-3.5-lightning:free");
    assert.ok(resolved.serverTools.some((t) => t.type === "openrouter:web_search"));
    assert.ok(resolved.serverTools.some((t) => t.type === "openrouter:web_fetch"));
  });

  it("gives providers with unverified capabilities NO tools (no guessing)", () => {
    const resolved = resolveAutoTools("groq", "some-unverified-model");
    assert.equal(resolved.functionTools.length, 0);
    assert.equal(resolved.serverTools.length, 0);
  });

  it("gives disabled native tools to nobody", () => {
    toolConfigStore.setEnabled("ostra:datetime", false);
    try {
      const resolved = resolveAutoTools("gemini", "gemini-2.5-flash");
      assert.ok(!resolved.functionTools.some((t) => t.toolId === "ostra:datetime"));
    } finally {
      toolConfigStore.setEnabled("ostra:datetime", true);
    }
  });
});

describe("malformed tool calls — structured refusals", () => {
  it("rejects an unknown tool id with unknown_tool", async () => {
    await assert.rejects(
      () => executeTool("ostra:does-not-exist", {}, {}),
      (error: unknown) => error instanceof ToolError && error.code === "unknown_tool",
    );
  });

  it("rejects non-object arguments with invalid_args", async () => {
    await assert.rejects(
      () => executeTool("ostra:web_fetch", "not-an-object", {}),
      (error: unknown) => error instanceof ToolError && error.code === "invalid_args",
    );
  });

  it("rejects web_fetch without url with invalid_args", async () => {
    await assert.rejects(
      () => executeTool("ostra:web_fetch", {}, {}),
      (error: unknown) => error instanceof ToolError && error.code === "invalid_args",
    );
  });

  it("compatibility check refuses models with unknown toolCalling capability", () => {
    const tool = getToolDefinition("ostra:datetime");
    assert.ok(tool);
    const result = checkModelToolCompatibility({ providerId: "groq", modelId: "openai/gpt-oss-120b", tool });
    assert.equal(result.compatible, true, "groq catalog model is verified for toolCalling");
    const unverified = checkModelToolCompatibility({ providerId: "groq", modelId: "made/up", tool });
    assert.equal(unverified.compatible, false);
    assert.equal(unverified.code, "unknown_model");
  });
});

// ---------------------------------------------------------------------------
// Stage 3 security: URL safety
// ---------------------------------------------------------------------------

describe("web fetch URL safety", () => {
  const tool = getToolDefinition("ostra:web_fetch")!;

  it("accepts a public https URL", () => {
    const result = validateFetchUrl("https://example.com/page");
    assert.ok(result.ok);
  });

  it("rejects non-http schemes (file:, ftp:, javascript:)", () => {
    for (const bad of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)"]) {
      const result = validateFetchUrl(bad);
      assert.ok(!result.ok, `${bad} must be rejected`);
    }
  });

  it("rejects loopback and private hosts (SSRF)", () => {
    for (const bad of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.1/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/x",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://db.internal/x",
    ]) {
      const result = validateFetchUrl(bad);
      assert.ok(!result.ok, `${bad} must be rejected`);
    }
  });

  it("rejects obviously invalid URLs", () => {
    assert.ok(!validateFetchUrl("").ok);
    assert.ok(!validateFetchUrl("not a url").ok);
    assert.ok(!validateFetchUrl(null).ok);
    assert.ok(!validateFetchUrl(42).ok);
  });

  it("rejects unusual ports", () => {
    assert.ok(!validateFetchUrl("http://example.com:22/x").ok);
    assert.ok(validateFetchUrl("http://example.com:8080/x").ok);
  });

  it("enforces the documented limits", () => {
    assert.equal(WEB_FETCH_LIMITS.timeoutMs, 15_000);
    assert.equal(WEB_FETCH_LIMITS.maxRedirects, 4);
    assert.ok(WEB_FETCH_LIMITS.maxBytes > 0);
    assert.ok(WEB_FETCH_LIMITS.maxOutputChars > 0 && WEB_FETCH_LIMITS.maxOutputChars <= 20_000);
  });

  it("web_fetch on a private URL returns a structured refusal (never throws)", async () => {
    const result = await executeNativeTool(tool, { url: "http://127.0.0.1:9/x" });
    assert.equal(result.ok, false);
    const parsed = JSON.parse(result.output) as { error: string };
    assert.equal(parsed.error, "invalid_url");
  });
});
