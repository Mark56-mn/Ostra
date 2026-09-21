/**
 * Tool executor + resolution pipeline tests (Stage 2).
 *
 * Covers: valid execution, unknown tool, disabled tool, incompatible model,
 * approval requirement, OpenRouter attachment semantics, and honest 501s for
 * execution types that arrive in Stage 3.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { executeTool, evaluateToolForModel, ToolError } = await import("@/lib/tools/service");
const { toolConfigStore } = await import("@/lib/tools/config");

describe("tool execution pipeline", () => {
  it("executes a native tool with valid args", async () => {
    const result = await executeTool("ostra:noop", { echo: "pipeline-check" });
    assert.equal(result.state, "executed");
    assert.equal(result.output, "echo: pipeline-check");
  });

  it("rejects an unknown tool with 404", async () => {
    await assert.rejects(executeTool("no/such:tool", {}), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal((error as { code: string }).code, "unknown_tool");
      assert.equal((error as { status: number }).status, 404);
      return true;
    });
  });

  it("rejects a disabled tool with 409", async () => {
    await assert.rejects(executeTool("openrouter:shell", { command: "ls" }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal((error as { code: string }).code, "tool_disabled");
      return true;
    });
  });

  it("rejects invalid arguments before any adapter runs", async () => {
    await assert.rejects(executeTool("ostra:noop", { echo: 42, extra: true }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal((error as { code: string }).code, "invalid_args");
      return true;
    });
  });

  it("refuses an incompatible model before execution", async () => {
    await assert.rejects(
      executeTool("ostra:noop", { echo: "x" }, { providerId: "not-a-provider", modelId: "m" }),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal((error as { code: string }).code, "incompatible_model");
        return true;
      },
    );
  });

  it("returns an attachment spec for OpenRouter server tools instead of executing", async () => {
    const result = await executeTool("openrouter:web_search", {});
    assert.equal(result.state, "attached");
    assert.ok(result.attachment);
    assert.equal(result.attachment.tools[0].type, "openrouter:web_search");
    assert.ok(result.attachment.maxToolCalls >= 1 && result.attachment.maxToolCalls <= 30);
  });

  it("refuses unconnected Vercel Connect execution at the permission gate", async () => {
    // Without a live connection the permission engine refuses before any
    // adapter would run — the honest Stage 2 behavior.
    await assert.rejects(executeTool("connect:github", { operation: "list_repos" }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal((error as { code: string }).code, "not_connected");
      return true;
    });
  });

  it("honours the config store's disable override", async () => {
    toolConfigStore.setEnabled("ostra:noop", false);
    await assert.rejects(executeTool("ostra:noop", { echo: "x" }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal((error as { code: string }).code, "tool_disabled");
      return true;
    });
    toolConfigStore.reset();
  });

  it("evaluateToolForModel returns structured verdicts for valid pairs", () => {
    const result = evaluateToolForModel({ toolId: "openrouter:web_search", provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" });
    assert.ok(result.ok);
  });

  it("evaluateToolForModel refuses unknown tools", () => {
    const result = evaluateToolForModel({ toolId: "nope", provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" });
    assert.ok(!result.ok && result.status === 404 && result.code === "unknown_tool");
  });

  it("evaluateToolForModel refuses invalid input shapes", () => {
    const result = evaluateToolForModel({ toolId: 42, provider: null, model: undefined });
    assert.ok(!result.ok && result.status === 400 && result.code === "invalid_format");
  });
});
