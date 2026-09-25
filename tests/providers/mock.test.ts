/**
 * Mock-provider tests.
 *
 * The mock is never a silent fallback: it answers only when it is EXPLICITLY
 * selected, and it never presents itself as a live model. With no selection
 * at all, the gateway refuses instead of guessing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

/** The mock is only reachable through an explicit `provider: "mock"`. */
const MOCK = { providerOverride: { providerId: "mock", modelId: "ostra-mock-1" } };

describe("mock provider", async () => {
  const { callProvider } = await import("@/lib/providers/gateway");
  const { resetProviderConfig } = await import("@/lib/providers/config");
  const { buildHealthPayload } = await import("@/lib/system/health");

  it("answers when explicitly selected", async () => {
    resetProviderConfig();
    const result = await callProvider([{ role: "user", content: "Hello Ostra" }], MOCK);
    assert.ok(result.content.length > 0);
    assert.equal(result.provider, "mock");
    assert.equal(result.model, "ostra-mock-1");
    assert.ok(result.latencyMs >= 0);
  });

  it("identifies itself as simulated in every reply", async () => {
    resetProviderConfig();
    const result = await callProvider([{ role: "user", content: "What can you do?" }], MOCK);
    assert.match(result.content, /mock/i);
    assert.match(result.content, /simulated/i);
  });

  it("never answers without an explicit selection", async () => {
    resetProviderConfig();
    await assert.rejects(
      () => callProvider([{ role: "user", content: "Hello Ostra" }]),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_not_selected");
        return true;
      },
    );
  });

  it("reports no active model in health, even though the mock exists", () => {
    resetProviderConfig();
    const health = buildHealthPayload(new Date("2026-01-01T00:00:00Z"));
    assert.equal(health.mode, "unselected");
    assert.equal(health.provider, "none");
    assert.equal(health.status, "unconfigured");
    assert.equal(health.endpointConfigured, false);
  });

  it("respects cancellation", async () => {
    resetProviderConfig();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => callProvider([{ role: "user", content: "hi" }], { ...MOCK, signal: controller.signal }),
      (error: Error) => error.name === "AbortError" || error.message.toLowerCase().includes("abort"),
    );
  });
});
