/**
 * Task configuration schema tests (Stage 2 typed task config).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

describe("task configuration schema", async () => {
  const { validateTaskConfig, TaskConfigSchema } = await import("@/lib/tasks/types");

  it("accepts a valid task configuration with defaults", () => {
    const result = validateTaskConfig({
      name: "Build the settings page",
      models: [{ provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "coder" }],
    });
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.data.maxSteps, 10);
      assert.equal(result.data.timeoutMs, 120_000);
    }
  });

  it("rejects empty model lists", () => {
    const result = validateTaskConfig({ name: "x", models: [] });
    assert.equal(result.valid, false);
    if (!result.valid) assert.ok(result.errors.some((e) => e.includes("At least one model")));
  });

  it("rejects more than 5 models", () => {
    const result = validateTaskConfig({
      name: "x",
      models: ["a", "b", "c", "d", "e", "f"].map((suffix) => ({
        provider: "openrouter",
        model: `model-${suffix}`,
      })),
    });
    assert.equal(result.valid, false);
  });

  it("rejects unknown roles", () => {
    const result = validateTaskConfig({
      name: "x",
      models: [{ provider: "openrouter", model: "m", role: "emperor" }],
    });
    assert.equal(result.valid, false);
  });

  it("enforces name length and step/timeout bounds", () => {
    assert.equal(validateTaskConfig({ name: "", models: [{ provider: "p", model: "m" }] }).valid, false);
    assert.equal(
      validateTaskConfig({ name: "x", models: [{ provider: "p", model: "m" }], maxSteps: 0 }).valid,
      false,
    );
    assert.equal(
      validateTaskConfig({ name: "x", models: [{ provider: "p", model: "m" }], timeoutMs: 1 }).valid,
      false,
    );
    const ok = validateTaskConfig({
      name: "x",
      models: [{ provider: "p", model: "m" }],
      maxSteps: 50,
      timeoutMs: 300_000,
    });
    assert.equal(ok.valid, true);
  });

  it("parses with defaults applied by zod", () => {
    const parsed = TaskConfigSchema.parse({
      name: "x",
      models: [{ provider: "p", model: "m" }],
    });
    assert.equal(parsed.models[0]?.role, "general");
  });
});
