/**
 * Mock-mode tests: the app must work with zero credentials configured and
 * the mock must never present itself as a live model.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

describe("mock mode", async () => {
  const { callProvider } = await import("@/lib/providers/gateway");
  const { resetProviderConfig } = await import("@/lib/providers/config");
  const { buildHealthPayload } = await import("@/lib/system/health");

  it("answers without any provider keys or configuration", async () => {
    resetProviderConfig();
    const result = await callProvider([{ role: "user", content: "Hello Ostra" }]);
    assert.ok(result.content.length > 0);
    assert.equal(result.provider, "mock");
    assert.equal(result.model, "ostra-mock-1");
    assert.ok(result.latencyMs >= 0);
  });

  it("identifies itself as simulated in every reply", async () => {
    resetProviderConfig();
    const result = await callProvider([{ role: "user", content: "What can you do?" }]);
    assert.match(result.content, /mock/i);
    assert.match(result.content, /simulated/i);
  });

  it("reports mock mode in health with status ok", () => {
    resetProviderConfig();
    const health = buildHealthPayload(new Date("2026-01-01T00:00:00Z"));
    assert.equal(health.mode, "mock");
    assert.equal(health.provider, "mock");
    assert.equal(health.status, "ok");
    assert.equal(health.endpointConfigured, false);
  });

  it("respects cancellation", async () => {
    resetProviderConfig();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => callProvider([{ role: "user", content: "hi" }], { signal: controller.signal }),
      (error: Error) => error.name === "AbortError" || error.message.toLowerCase().includes("abort"),
    );
  });
});
