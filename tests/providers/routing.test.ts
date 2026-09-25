/**
 * Provider configuration tests.
 *
 * Covers the rule this architecture exists for: the environment supplies
 * CREDENTIALS and ENDPOINTS, never the provider/model choice. `AI_PROVIDER`
 * and `AI_MODEL` are not read anywhere — even when set, they select nothing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap, setEnv } from "../helpers/env.ts";

await flushBootstrap();

const { resolveProviderConfig, getProviderHealthStatus, isCustomEndpointConfigured, resetProviderConfig } = await import(
  "@/lib/providers/config"
);
const { getProviderStatusSummary } = await import("@/lib/providers/config-status");
const { getModelCatalog, isModelAllowed, getModelsForProvider } = await import("@/lib/providers/catalog");
const { PROVIDERS, getProviderBaseUrl, getProviderDefinition } = await import("@/lib/providers/registry");

describe("no global provider or model default", () => {
  it("selects nothing when the environment is empty", () => {
    resetProviderConfig();
    const config = resolveProviderConfig();
    assert.equal(config.customEndpoint, null);

    // No provider is "active" through configuration alone.
    const summary = getProviderStatusSummary();
    assert.equal(summary.mode, "unselected");
    assert.equal(summary.providers.every((p) => p.active === false), true);
  });

  it("ignores AI_PROVIDER even when it is set to a real provider", () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();

    // The key is configuration, so the provider becomes selectable…
    const summary = getProviderStatusSummary();
    assert.equal(summary.providers.find((p) => p.id === "openrouter")?.active, true);
    // …but AI_PROVIDER itself decided nothing: nothing is globally active.
    assert.equal(summary.mode !== "unselected", true);
    assert.equal(summary.id, "none");
    assert.equal(summary.model, "");
  });

  it("ignores an invalid AI_PROVIDER instead of failing configuration", () => {
    setEnv({ AI_PROVIDER: "does-not-exist" });
    resetProviderConfig();
    const summary = getProviderStatusSummary();
    assert.equal(summary.mode, "unselected");
    assert.equal(JSON.stringify(summary).includes("does-not-exist"), false);
  });

  it("never reports a model from the environment", () => {
    setEnv({ AI_MODEL: "some-model", AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const summary = getProviderStatusSummary();
    assert.equal(summary.model, "");
    assert.equal(summary.providers.every((p) => p.model === ""), true);
  });
});

describe("custom HTTP provider", () => {
  it("is registered as a selectable provider", () => {
    assert.ok(getProviderDefinition("custom-http"));
    assert.ok(PROVIDERS.some((p) => p.id === "custom-http"));
  });

  it("resolves its endpoint from MODEL_API_URL", () => {
    setEnv({ MODEL_API_URL: "https://kaggle-tunnel.example/v1/chat/completions", MODEL_API_KEY: "k" });
    resetProviderConfig();
    const definition = getProviderDefinition("custom-http")!;
    assert.equal(getProviderBaseUrl(definition), "https://kaggle-tunnel.example/v1");
    assert.equal(isCustomEndpointConfigured(), true);
    assert.equal(resolveProviderConfig().customEndpoint?.apiKey, "k");
  });

  it("is unconfigured (not silently routed elsewhere) without MODEL_API_URL", () => {
    resetProviderConfig();
    assert.equal(isCustomEndpointConfigured(), false);
    assert.equal(getProviderBaseUrl(getProviderDefinition("custom-http")!), "");
    assert.equal(isModelAllowed("custom-http", "Qwen/Qwen3-1.7B"), false);
  });

  it("accepts a well-formed model id once an endpoint is configured", () => {
    setEnv({ MODEL_API_URL: "https://kaggle-tunnel.example/v1", MODEL_NAME: "Qwen/Qwen3-1.7B" });
    resetProviderConfig();
    assert.equal(isModelAllowed("custom-http", "Qwen/Qwen3-1.7B"), true);
    assert.equal(getModelsForProvider("custom-http").some((m) => m.id === "Qwen/Qwen3-1.7B"), true);
    // Path traversal / junk shapes stay rejected.
    assert.equal(isModelAllowed("custom-http", "../../etc/passwd"), false);
  });
});

describe("provider catalog", () => {
  it("still lists every provider with its allowlisted models", () => {
    setEnv({ OPENROUTER_API_KEY: "sk-secret-value" });
    resetProviderConfig();
    const catalog = getModelCatalog();
    assert.ok(catalog.length >= 5);
    const openrouter = catalog.find((p) => p.id === "openrouter");
    assert.ok((openrouter?.models.length ?? 0) >= 3);
    assert.equal(openrouter?.keyPresent, true);
    // No key value ever leaves the server.
    assert.equal(JSON.stringify(catalog).includes("sk-secret-value"), false);
  });

  it("reports no globally active provider", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const summary = getProviderStatusSummary();
    assert.equal(summary.id, "none");
    assert.equal(getProviderHealthStatus().configured, false);
  });
});
