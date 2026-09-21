/**
 * Chat tool-attachment tests (Stage 2) — the security-critical path between
 * POST /api/chat and the model gateway.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { resolveChatTools, ChatToolError } = await import("@/lib/tools/chat-tools");
const { toolConfigStore } = await import("@/lib/tools/config");

const OPENROUTER_MODEL = { providerId: "openrouter", modelId: "nvidia/nemotron-3.5-lightning:free" };
const GEMINI_MODEL = { providerId: "gemini", modelId: "gemini-2.5-flash" };

describe("chat tool attachments", () => {
  it("returns null when no tools are requested", () => {
    assert.equal(resolveChatTools(undefined, OPENROUTER_MODEL), null);
    assert.equal(resolveChatTools(null, OPENROUTER_MODEL), null);
  });

  it("attaches a valid OpenRouter server tool for an OpenRouter model", () => {
    const attachment = resolveChatTools(["openrouter:web_search"], OPENROUTER_MODEL);
    assert.ok(attachment);
    assert.equal(attachment.tools[0].type, "openrouter:web_search");
    assert.ok(attachment.maxToolCalls >= 1 && attachment.maxToolCalls <= 30);
  });

  it("accepts { id, args } entries and string ids", () => {
    const attachment = resolveChatTools([{ id: "openrouter:web_search" }, "openrouter:datetime"], OPENROUTER_MODEL);
    assert.ok(attachment);
    assert.equal(attachment.tools.length, 2);
  });

  it("acknowledges attachments in mock mode without executing anything", () => {
    const attachment = resolveChatTools(["openrouter:web_search"], { providerId: "mock", modelId: "ostra-mock-1" });
    assert.ok(attachment, "mock mode should accept the shape");
  });

  it("rejects unknown tool ids", () => {
    assert.throws(() => resolveChatTools(["openrouter:not_real"], OPENROUTER_MODEL), (error: unknown) => {
      assert.ok(error instanceof ChatToolError);
      assert.equal((error as { code: string }).code, "unknown_tool");
      return true;
    });
  });

  it("rejects disabled tools", () => {
    assert.throws(() => resolveChatTools(["openrouter:shell"], OPENROUTER_MODEL), (error: unknown) => {
      assert.ok(error instanceof ChatToolError);
      assert.equal((error as { code: string }).code, "tool_disabled");
      return true;
    });
  });

  it("rejects non-OpenRouter tools as not attachable", () => {
    assert.throws(() => resolveChatTools(["ostra:noop"], OPENROUTER_MODEL), (error: unknown) => {
      assert.ok(error instanceof ChatToolError);
      assert.equal((error as { code: string }).code, "tool_not_attachable");
      return true;
    });
  });

  it("rejects OpenRouter tools for non-OpenRouter providers", () => {
    assert.throws(() => resolveChatTools(["openrouter:web_search"], GEMINI_MODEL), (error: unknown) => {
      assert.ok(error instanceof ChatToolError);
      assert.equal((error as { code: string }).code, "provider_mismatch");
      return true;
    });
  });

  it("rejects models with unverified tool capabilities", () => {
    assert.throws(
      () => resolveChatTools(["openrouter:web_search"], { providerId: "openrouter", modelId: "google/gemma-4-31b-it:free" }),
      (error: unknown) => {
        assert.ok(error instanceof ChatToolError);
        assert.equal((error as { code: string }).code, "incompatible_model");
        return true;
      },
    );
  });

  it("rejects malformed tool arrays and oversized batches", () => {
    assert.throws(() => resolveChatTools([], OPENROUTER_MODEL), ChatToolError);
    assert.throws(() => resolveChatTools("web_search", OPENROUTER_MODEL), ChatToolError);
    const tooMany = Array.from({ length: 11 }, () => "openrouter:web_search");
    assert.throws(() => resolveChatTools(tooMany, OPENROUTER_MODEL), ChatToolError);
  });

  it("rejects entries without a string id", () => {
    assert.throws(() => resolveChatTools([{ args: {} }], OPENROUTER_MODEL), ChatToolError);
  });

  it("respects a workspace-level disable override", () => {
    toolConfigStore.setEnabled("openrouter:web_search", false);
    assert.throws(() => resolveChatTools(["openrouter:web_search"], OPENROUTER_MODEL), (error: unknown) => {
      assert.ok(error instanceof ChatToolError);
      assert.equal((error as { code: string }).code, "tool_disabled");
      return true;
    });
    toolConfigStore.reset();
  });
});
