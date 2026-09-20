/**
 * Provider routing + configuration resolution tests.
 *
 * Covers: mock-mode default, explicit provider selection, invalid-provider
 * error (must NOT silently become mock), legacy MODEL_MODE compat, and
 * config-cache resets between tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { resolveProviderConfig, getProviderHealthStatus, resetProviderConfig } = await import("@/lib/providers/config");
const { getProviderStatusSummary } = await import("@/lib/providers/config-status");
const { PROVIDERS } = await import("@/lib/providers/registry");

describe("provider configuration routing", () => {
  it("defaults to mock mode when nothing is configured", () => {
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.mode, "mock");
    assert.equal(config.provider, null);
    assert.equal(config.configError, null);
  });

  it("resolves an explicit AI_PROVIDER with its key env var", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-key-123";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.mode, "provider");
    assert.equal(config.provider?.id, "openrouter");
    assert.equal(config.provider?.apiKey, "test-key-123");
    assert.equal(config.configError, null);
  });

  it("prefers AI_API_KEY over the provider-specific key variable", () => {
    process.env.AI_PROVIDER = "groq";
    process.env.AI_API_KEY = "generic-key";
    process.env.GROQ_API_KEY = "provider-key";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.provider?.apiKey, "generic-key");
  });

  it("flags a configured provider without a key (does not fall back to mock)", () => {
    process.env.AI_PROVIDER = "nvidia";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.mode, "provider");
    assert.equal(config.provider?.id, "nvidia");
    assert.equal(config.provider?.apiKey, null);
  });

  it("accepts an explicit AI_PROVIDER=mock", () => {
    process.env.AI_PROVIDER = "mock";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.mode, "mock");
    assert.equal(config.configError, null);
    const health = getProviderHealthStatus();
    assert.equal(health.id, "mock");
    assert.equal(health.configured, false);
  });

  it("rejects an invalid AI_PROVIDER instead of silently using mock", () => {
    process.env.AI_PROVIDER = "does-not-exist";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.ok(config.configError, "expected a config error");
    assert.match(config.configError, /Invalid AI_PROVIDER/);
    assert.match(config.configError, /does-not-exist/);

    const health = getProviderHealthStatus();
    assert.equal(health.id, "error");
  });

  it("reports the invalid provider in the status summary without leaking values", () => {
    process.env.AI_PROVIDER = "does-not-exist";
    resetProviderConfig();
    const summary = getProviderStatusSummary();
    assert.equal(summary.id, "error");
    assert.ok(summary.configError?.includes("does-not-exist"));
    // The summary must not include any secret-shaped strings.
    assert.equal(JSON.stringify(summary).includes("sk-"), false);
  });

  it("supports legacy MODEL_MODE=http + MODEL_API_URL as a custom provider", () => {
    process.env.MODEL_MODE = "http";
    process.env.MODEL_API_URL = "https://kaggle-tunnel.example/v1/chat/completions";
    process.env.MODEL_API_KEY = "legacy-key";
    process.env.MODEL_NAME = "ostra-experimental";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.mode, "provider");
    assert.equal(config.provider?.id, "custom");
    assert.equal(config.provider?.apiKey, "legacy-key");
  });

  it("MODEL_MODE=mock wins over AI_PROVIDER unset", () => {
    process.env.MODEL_MODE = "mock";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.mode, "mock");
  });

  it("respects AI_MODEL and MODEL_TIMEOUT_MS overrides", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "k";
    process.env.AI_MODEL = "qwen/qwen3.8-27b:free";
    process.env.MODEL_TIMEOUT_MS = "25000";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.provider?.model, "qwen/qwen3.8-27b:free");
    assert.equal(config.provider?.timeoutMs, 25000);
  });

  it("clamps MODEL_TIMEOUT_MS into a sane range", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "k";
    process.env.MODEL_TIMEOUT_MS = "1";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.provider?.timeoutMs, 5000);
  });

  it("registers exactly the verified provider set", () => {
    assert.deepEqual(
      PROVIDERS.map((p) => p.id).sort(),
      ["gemini", "groq", "mistral", "nvidia", "openrouter"],
    );
  });

  it("honours MODEL_MAX_TOKENS and MODEL_TEMPERATURE", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "k";
    process.env.MODEL_MAX_TOKENS = "2048";
    process.env.MODEL_TEMPERATURE = "0.2";
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.provider?.maxTokens, 2048);
    assert.equal(config.provider?.temperature, 0.2);
  });
});
