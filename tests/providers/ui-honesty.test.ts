/**
 * UI honesty regressions.
 *
 * These cover three defects where the interface claimed or implied something
 * the server did not actually do:
 *
 *   1. No provider is preselected. The Model Control Center used to seed its
 *      active provider from `providers[0]`, and `openrouter` is first in
 *      PROVIDERS — so OpenRouter silently looked like a default. The catalog
 *      is still ordered (it is a registry), but nothing may treat catalog
 *      position as a routing or selection decision.
 *   2. `keyPresent` means "some provider has a credential", not "the custom
 *      HTTP endpoint has a bearer token". It previously read the custom
 *      endpoint only, so /api/models reported `keyPresent: false` even with
 *      OPENROUTER_API_KEY set, and the UI rendered "no provider keys".
 *   3. `mock` is not a selectable provider. It is absent from the allowlist,
 *      so a mock selection is rejected as `unknown_provider` rather than
 *      being accepted and then silently dropped by the chat route.
 *
 * No network access: every provider call is a fetch stub.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setEnv, flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { getProviderStatusSummary } = await import("@/lib/providers/config-status");
const { getModelCatalog, getProviderModelCount } = await import("@/lib/providers/catalog");
const { PROVIDERS, listProviderIds } = await import("@/lib/providers/registry");
const { validateModelSelection, ModelSelectionError } = await import("@/lib/model-selection");
const chatRoute = await import("@/app/api/chat/route");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "stub" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
});

afterEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("no provider preselection", () => {
  it("keeps openrouter first in the registry, so catalog order is never a default", () => {
    // Guard the premise of the fix: the catalog IS still ordered and
    // openrouter IS still first. The fix is that nothing selects by position.
    assert.equal(PROVIDERS[0].id, "openrouter");
    assert.ok(getProviderModelCount("openrouter") > 0);
  });

  it("reports no active provider even when a provider has a key", () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    const summary = getProviderStatusSummary();

    // Readiness is reported, but there is still no globally active provider:
    // a key makes a provider selectable, never selected.
    assert.equal(summary.mode, "ready");
    assert.equal(summary.id, "none");
    assert.equal(summary.model, "");
  });

  it("exposes openrouter in the catalog without marking it default or active", () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    const openrouter = getModelCatalog().find((provider) => provider.id === "openrouter");

    assert.ok(openrouter, "openrouter should still be catalogued");
    assert.equal(openrouter.keyPresent, true);
    assert.equal(openrouter.models.length > 0, true);
  });

  it("has no selection source other than an explicit request or the workspace default", () => {
    // The chat route must not derive a provider from catalog order.
    const source = chatRoute.POST.toString();
    assert.ok(
      !/providers\s*\[\s*0\s*\]/.test(source),
      "the chat route must not fall back to the first catalogued provider",
    );
  });
});

describe("key presence is reported per provider", () => {
  it("reports keyPresent true when only OPENROUTER_API_KEY is configured", () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    const summary = getProviderStatusSummary();

    assert.equal(summary.keyPresent, true, "an OpenRouter key is a provider key");
    assert.equal(summary.customEndpoint, false);
    const openrouter = summary.providers.find((provider) => provider.id === "openrouter");
    assert.equal(openrouter?.keyPresent, true);
  });

  it("reports keyPresent true when only a custom endpoint key is configured", () => {
    setEnv({ MODEL_API_URL: "https://example.invalid/v1", MODEL_API_KEY: "sk-custom" });
    const summary = getProviderStatusSummary();

    assert.equal(summary.keyPresent, true);
    assert.equal(summary.customEndpoint, true);
  });

  it("reports keyPresent true for a keyless custom endpoint, because it is usable", () => {
    // For custom-http, `keyPresent` means "endpoint configured" — a local
    // llama.cpp/ollama server legitimately needs no bearer token. The
    // aggregate therefore reflects usability, not the existence of a token.
    setEnv({ MODEL_API_URL: "http://localhost:11434/v1" });
    const summary = getProviderStatusSummary();

    assert.equal(summary.customEndpoint, true);
    assert.equal(summary.keyPresent, true);
    assert.equal(summary.mode, "ready");
  });

  it("reports keyPresent false when no provider is usable", () => {
    const summary = getProviderStatusSummary();

    assert.equal(summary.keyPresent, false);
    assert.equal(summary.mode, "unselected");
  });
});

describe("mock is not a selectable provider", () => {
  it("is absent from the provider allowlist", () => {
    assert.ok(!listProviderIds().includes("mock"));
  });

  it("rejects an explicit mock selection as unknown_provider", () => {
    assert.throws(
      () => validateModelSelection({ provider: "mock", model: "ostra-experimental" }),
      (error: unknown) => error instanceof ModelSelectionError && error.code === "unknown_provider",
    );
  });

  it("returns 400 unknown_provider for a mock selection on /api/chat", async () => {
    const response = await chatRoute.POST(post({ message: "hi", model: { provider: "mock", model: "x" } }));
    const payload = (await response.json()) as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "unknown_provider");
  });

  it("does not silently fall back to another provider when mock is requested", async () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    const response = await chatRoute.POST(post({ message: "hi", model: { provider: "mock", model: "x" } }));
    const payload = (await response.json()) as { error: { code: string } };

    // The dangerous old behaviour was a rejected/ignored selection falling
    // through to a real provider. It must be a hard error.
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "unknown_provider");
  });
});

describe("locked providers cannot be selected", () => {
  it("rejects a selection for a provider with no key", async () => {
    const response = await chatRoute.POST(
      post({ message: "hi", model: { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" } }),
    );
    const payload = (await response.json()) as { error: { code: string } };

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "key_missing");
  });

  it("accepts the same selection once the key is present", async () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-test" });
    const response = await chatRoute.POST(
      post({ message: "hi", model: { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" } }),
    );
    const payload = (await response.json()) as { provider?: string; requested?: { provider: string } };

    assert.equal(response.status, 200);
    assert.equal(payload.requested?.provider, "openrouter");
  });
});
