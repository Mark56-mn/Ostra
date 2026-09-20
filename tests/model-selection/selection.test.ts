/**
 * Stage 2 model selection: allowlist enforcement, key-presence rule,
 * duplicate/role constraints, and the workspace store contract.
 *
 * Security invariants tested here:
 * - only allowlisted provider/model pairs pass
 * - providers without a configured key are rejected (409)
 * - no selection shape can smuggle in an arbitrary provider or model
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setEnv } from "../helpers/env.ts";

describe("model selection validation", async () => {
  const { validateModelSelection, validateSelectionList, ModelSelectionError } = await import("@/lib/model-selection");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  function expectError(fn: () => unknown, code: string, status?: number): void {
    assert.throws(fn, (error: unknown) => {
      assert.ok(error instanceof ModelSelectionError, `expected ModelSelectionError, got ${String(error)}`);
      assert.equal(error.code, code);
      if (status !== undefined) assert.equal(error.status, status);
      return true;
    });
  }

  it("accepts an allowlisted selection when the key is configured", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const selection = validateModelSelection({ provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" });
    assert.equal(selection.provider, "openrouter");
    assert.equal(selection.model, "nvidia/nemotron-3.5-lightning:free");
    assert.equal(selection.role, "general");
  });

  it("accepts an explicit valid role", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const selection = validateModelSelection({
      provider: "openrouter",
      model: "qwen/qwen3.8-27b:free",
      role: "coder",
    });
    assert.equal(selection.role, "coder");
  });

  it("rejects non-allowlisted models", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    expectError(() => validateModelSelection({ provider: "openrouter", model: "openai/gpt-4o" }), "model_not_allowed");
    expectError(
      () => validateModelSelection({ provider: "openrouter", model: "../../etc/passwd" }),
      "model_not_allowed",
    );
  });

  it("rejects unknown providers without echoing them back", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    try {
      validateModelSelection({ provider: "sketchy-provider", model: "x" });
      assert.fail("expected rejection");
    } catch (error) {
      assert.ok(error instanceof ModelSelectionError);
      assert.equal(error.code, "unknown_provider");
      assert.equal(String(error.message).includes("sketchy-provider"), false);
    }
  });

  it("rejects selections for providers with no configured key (409)", () => {
    setEnv({ OPENROUTER_API_KEY: "k" }); // gemini has no key
    resetProviderConfig();
    expectError(
      () => validateModelSelection({ provider: "gemini", model: "gemini-2.5-flash" }),
      "key_missing",
      409,
    );
  });

  it("rejects malformed selections", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    expectError(() => validateModelSelection(null), "invalid_format");
    expectError(() => validateModelSelection("openrouter"), "invalid_format");
    expectError(() => validateModelSelection({ provider: "", model: "x" }), "invalid_format");
    expectError(() => validateModelSelection({ provider: "openrouter" }), "invalid_format");
    expectError(() => validateModelSelection({ provider: "openrouter", model: "" }), "invalid_format");
    expectError(() => validateModelSelection({ provider: "openrouter", model: "x".repeat(300) }), "invalid_format");
    expectError(
      () => validateModelSelection({ provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "hacker" }),
      "invalid_format",
    );
  });

  it("rejects unlisted roles", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    expectError(
      () => validateModelSelection({ provider: "openrouter", model: "google/gemma-4-31b-it:free", role: "root" }),
      "invalid_format",
    );
  });

  it("validates multi-model task lists", () => {
    setEnv({ OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g" });
    resetProviderConfig();

    const selections = validateSelectionList([
      { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "planner" },
      { provider: "gemini", model: "gemini-2.5-flash", role: "coder" },
      { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    ]);
    assert.equal(selections.length, 3);
    assert.equal(selections[2]?.role, "general");
  });

  it("enforces duplicate-model and duplicate-role rules", () => {
    setEnv({ OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g" });
    resetProviderConfig();

    expectError(
      () =>
        validateSelectionList([
          { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "planner" },
          { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "coder" },
        ]),
      "invalid_format",
    );

    expectError(
      () =>
        validateSelectionList([
          { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "planner" },
          { provider: "gemini", model: "gemini-2.5-flash", role: "planner" },
        ]),
      "duplicate_role",
    );
  });

  it("caps the number of models per task", () => {
    setEnv({ OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g" });
    resetProviderConfig();

    expectError(
      () =>
        validateSelectionList([
          { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" },
          { provider: "openrouter", model: "qwen/qwen3.8-27b:free" },
          { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
          { provider: "gemini", model: "gemini-2.5-flash" },
          { provider: "gemini", model: "gemini-2.5-flash-lite" },
          { provider: "gemini", model: "gemini-2.5-pro" },
        ]),
      "too_many_models",
    );
  });

  it("rejects empty or non-array model lists", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    expectError(() => validateSelectionList([]), "invalid_format");
    expectError(() => validateSelectionList("openrouter"), "invalid_format");
    expectError(() => validateSelectionList(null), "invalid_format");
  });
});

describe("workspace selection store", async () => {
  const { modelSelectionStore } = await import("@/lib/model-selection/store");
  const { ModelSelectionError } = await import("@/lib/model-selection");

  it("persists a default selection (in-memory seam)", () => {
    const saved = modelSelectionStore.setDefault({ provider: "openrouter", model: "qwen/qwen3.8-27b:free", role: "general" });
    assert.equal(saved.provider, "openrouter");
    assert.equal(modelSelectionStore.getState().default?.model, "qwen/qwen3.8-27b:free");
  });

  it("persists a task configuration snapshot with no execution state", () => {
    const snapshot = modelSelectionStore.setTaskConfig({
      name: "test config",
      models: [{ provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "planner" }],
    });
    assert.equal(snapshot.status, "configured");
    assert.equal(modelSelectionStore.getState().taskConfig?.models.length, 1);
  });

  it("resets cleanly between tests", () => {
    modelSelectionStore.reset();
    assert.equal(modelSelectionStore.getState().default, null);
    assert.equal(modelSelectionStore.getState().taskConfig, null);
  });

  it("never stores key material", () => {
    const serialized = JSON.stringify(modelSelectionStore.getState());
    assert.equal(serialized.toLowerCase().includes("apikey"), false);
    assert.equal(serialized.toLowerCase().includes("bearer"), false);
    void ModelSelectionError; // keep import meaningful
  });
});
