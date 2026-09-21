/**
 * Model ↔ tool compatibility tests (Stage 2).
 *
 * Covers: compatible pairs, incompatible (missing capability), unverified
 * ("unknown" refuses rather than guesses), unknown model/provider, disabled
 * model, and unknown tools.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { checkModelToolCompatibility } = await import("@/lib/tools/compatibility");
const { getToolDefinition } = await import("@/lib/tools/registry");

function tool(id: string) {
  const t = getToolDefinition(id);
  if (!t) throw new Error(`missing tool ${id}`);
  return t;
}

describe("model ↔ tool compatibility", () => {
  it("accepts a verified tool-calling model with an OpenRouter server tool", () => {
    const result = checkModelToolCompatibility({
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3.5-lightning:free",
      tool: tool("openrouter:web_search"),
    });
    assert.equal(result.compatible, true);
    assert.equal(result.code, "compatible");
  });

  it("accepts Gemini models (tool calling verified)", () => {
    const result = checkModelToolCompatibility({
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
      tool: tool("openrouter:web_search"),
    });
    assert.equal(result.compatible, true);
  });

  it("refuses models with unverified capabilities instead of guessing", () => {
    const result = checkModelToolCompatibility({
      providerId: "openrouter",
      modelId: "google/gemma-4-31b-it:free",
      tool: tool("openrouter:web_search"),
    });
    assert.equal(result.compatible, false);
    assert.equal(result.code, "capability_unknown");
    assert.match(result.message, /unverified/);
  });

  it("refuses models with no capability entry at all", () => {
    const result = checkModelToolCompatibility({
      providerId: "openrouter",
      modelId: "totally/unknown-model",
      tool: tool("openrouter:web_search"),
    });
    assert.equal(result.compatible, false);
    assert.equal(result.code, "unknown_model");
  });

  it("refuses unknown providers", () => {
    const result = checkModelToolCompatibility({
      providerId: "not-a-provider",
      modelId: "some/model",
      tool: tool("openrouter:web_search"),
    });
    assert.equal(result.compatible, false);
    assert.equal(result.code, "unknown_provider");
  });

  it("respects the disabled-model flag", () => {
    const result = checkModelToolCompatibility({
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3.5-lightning:free",
      modelIsCatalogDefault: false,
      tool: tool("openrouter:web_search"),
    });
    assert.equal(result.compatible, false);
    assert.equal(result.code, "model_disabled");
  });

  it("refuses disabled tools", () => {
    const result = checkModelToolCompatibility({
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3.5-lightning:free",
      tool: tool("openrouter:shell"), // disabled, high-risk
    });
    assert.equal(result.compatible, false);
    assert.equal(result.code, "tool_disabled");
  });

  it("flags Vercel Connect tools as not connected until probed", () => {
    const result = checkModelToolCompatibility({
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3.5-lightning:free",
      tool: tool("connect:github"),
    });
    assert.equal(result.compatible, false);
    assert.equal(result.code, "not_connected");
  });
});
