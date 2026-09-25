/**
 * Explicit model selection is the routing authority.
 *
 * The seven behaviours this architecture promises:
 *   1. no global provider default      5. custom HTTP selection reaches the HTTP adapter
 *   2. no global model default         6. a missing selection is a clear error
 *   3. the selection reaches the gateway   7. the provider/model catalog still works
 *   4. switching providers takes effect
 *
 * No network access: every provider call is a fetch stub.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setEnv, flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { callProvider } = await import("@/lib/providers/gateway");
const { resetProviderConfig } = await import("@/lib/providers/config");
const { getModelCatalog, isModelAllowed, getModelsForProvider } = await import("@/lib/providers/catalog");
const { validateModelSelection, ModelSelectionError } = await import("@/lib/model-selection");
const { modelSelectionStore } = await import("@/lib/model-selection/store");
const chatRoute = await import("@/app/api/chat/route");

const originalFetch = globalThis.fetch;

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

let calls: Call[] = [];

function ok(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Gemini speaks its own response shape; keep the stub faithful. */
function okForUrl(url: string, content: string): Response {
  if (url.includes("generativelanguage.googleapis.com")) {
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: content }], role: "model" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return ok(content);
}

beforeEach(() => {
  calls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(okForUrl(url, "reply"));
  };
});

afterEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
});

const MESSAGES = [{ role: "user" as const, content: "Hello Ostra" }];

describe("1 & 2 — no global provider or model default", () => {
  it("does not choose OpenRouter (or anything else) when nothing is selected", async () => {
    setEnv({ OPENROUTER_API_KEY: "openrouter-key" });
    resetProviderConfig();

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string; provider?: string }) => {
        assert.equal(error.code, "model_not_selected");
        // It refused BEFORE resolving any provider — no request was made.
        assert.equal(error.provider, "none");
        return true;
      },
    );
    assert.equal(calls.length, 0, "no provider may be called without a selection");
  });

  it("ignores AI_PROVIDER / AI_MODEL entirely, even when they are set", async () => {
    setEnv({
      AI_PROVIDER: "openrouter",
      AI_MODEL: "nvidia/nemotron-3.5-lightning:free",
      OPENROUTER_API_KEY: "openrouter-key",
    });
    resetProviderConfig();

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string }) => error.code === "model_not_selected",
    );
    assert.equal(calls.length, 0);
  });
});

describe("3 — the explicit selection reaches the gateway", () => {
  it("calls exactly the selected provider and model", async () => {
    setEnv({ GROQ_API_KEY: "groq-key", OPENROUTER_API_KEY: "openrouter-key" });
    resetProviderConfig();

    const result = await callProvider(MESSAGES, {
      providerOverride: { providerId: "groq", modelId: "openai/gpt-oss-120b" },
    });

    assert.equal(result.provider, "groq");
    assert.equal(result.model, "openai/gpt-oss-120b");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith("https://api.groq.com/openai/v1"));
    assert.equal(calls[0].body.model, "openai/gpt-oss-120b");
    assert.equal(calls[0].headers.authorization, "Bearer groq-key");
  });

  it("never sends the selection's credential to another provider", async () => {
    setEnv({ GROQ_API_KEY: "groq-key", OPENROUTER_API_KEY: "openrouter-key" });
    resetProviderConfig();

    await callProvider(MESSAGES, {
      providerOverride: { providerId: "openrouter", modelId: "qwen/qwen3.8-27b:free" },
    });

    assert.ok(calls[0].url.includes("openrouter.ai"));
    assert.equal(calls[0].headers.authorization, "Bearer openrouter-key");
    assert.equal(calls[0].headers.authorization.includes("groq-key"), false);
  });
});

describe("4 — provider switching takes effect on the next request", () => {
  it("uses B after the user switches from A, regardless of any env default", async () => {
    setEnv({ GROQ_API_KEY: "groq-key", GEMINI_API_KEY: "gemini-key" });
    resetProviderConfig();

    await callProvider(MESSAGES, { providerOverride: { providerId: "groq", modelId: "openai/gpt-oss-120b" } });
    await callProvider(MESSAGES, { providerOverride: { providerId: "gemini", modelId: "gemini-flash-latest" } });

    assert.ok(calls[0].url.includes("api.groq.com"));
    assert.ok(calls[1].url.includes("generativelanguage.googleapis.com"));
    assert.ok(calls[1].url.includes("models/gemini-flash-latest"));
  });

  it("routes through /api/chat to the newly selected provider after a switch", async () => {
    setEnv({ GROQ_API_KEY: "groq-key", NVIDIA_API_KEY: "nvidia-key" });
    resetProviderConfig();
    modelSelectionStore.reset();

    const post = (model: { provider: string; model: string }) =>
      chatRoute.POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi", model }),
        }),
      );

    const first = (await post({ provider: "groq", model: "openai/gpt-oss-120b" })).json() as Promise<{ provider: string }>;
    assert.equal((await first).provider, "groq");

    const second = (await post({ provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b" })).json() as Promise<{
      provider: string;
      model: string;
    }>;
    const secondPayload = await second;
    assert.equal(secondPayload.provider, "nvidia");
    assert.equal(secondPayload.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  });
});

describe("5 — custom HTTP selection reaches the OpenAI-compatible adapter", () => {
  it("posts to the configured MODEL_API_URL with the selected model", async () => {
    setEnv({
      MODEL_API_URL: "https://example-endpoint.test/v1/chat/completions",
      MODEL_API_KEY: "custom-key",
      MODEL_NAME: "Qwen/Qwen3-1.7B",
      // A real provider key must not pull the request away from custom-http.
      OPENROUTER_API_KEY: "openrouter-key",
    });
    resetProviderConfig();

    const result = await callProvider(MESSAGES, {
      providerOverride: { providerId: "custom-http", modelId: "Qwen/Qwen3-1.7B" },
    });

    assert.equal(result.provider, "custom-http");
    assert.equal(result.model, "Qwen/Qwen3-1.7B");
    assert.equal(calls.length, 1);
    // No hard-coded endpoint: it comes from configuration, with the
    // /chat/completions suffix added exactly once.
    assert.equal(calls[0].url, "https://example-endpoint.test/v1/chat/completions");
    assert.equal(calls[0].body.model, "Qwen/Qwen3-1.7B");
    assert.equal(calls[0].headers.authorization, "Bearer custom-key");
  });

  it("is selectable through /api/chat and validated as a selection", async () => {
    setEnv({ MODEL_API_URL: "https://example-endpoint.test/v1", MODEL_NAME: "Qwen/Qwen3-1.7B" });
    resetProviderConfig();

    const selection = validateModelSelection({ provider: "custom-http", model: "Qwen/Qwen3-1.7B" });
    assert.equal(selection.provider, "custom-http");
    assert.equal(selection.model, "Qwen/Qwen3-1.7B");

    const response = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", model: { provider: "custom-http", model: "Qwen/Qwen3-1.7B" } }),
      }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { provider: string; model: string; mode: string };
    assert.equal(payload.provider, "custom-http");
    assert.equal(payload.model, "Qwen/Qwen3-1.7B");
    assert.equal(payload.mode, "live");
    assert.equal(calls[0].url, "https://example-endpoint.test/v1/chat/completions");
  });

  it("refuses a custom HTTP selection when no endpoint is configured", async () => {
    setEnv({});
    resetProviderConfig();
    assert.throws(
      () => validateModelSelection({ provider: "custom-http", model: "Qwen/Qwen3-1.7B" }),
      (error: unknown) => error instanceof ModelSelectionError && error.code === "endpoint_missing",
    );
  });
});

describe("6 — a missing selection is a clear error, never a silent fallback", () => {
  it("/api/chat answers 409 model_not_selected with actionable text", async () => {
    setEnv({ OPENROUTER_API_KEY: "openrouter-key" });
    resetProviderConfig();
    modelSelectionStore.reset();
    await flushBootstrap();
    modelSelectionStore.reset();

    const response = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Hello Ostra" }),
      }),
    );

    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(payload.error.code, "model_not_selected");
    assert.match(payload.error.message, /select a provider and model/i);
    assert.equal(calls.length, 0, "no provider may be called");
  });

  it("reports the error without leaking configuration", async () => {
    setEnv({ OPENROUTER_API_KEY: "sk-super-secret" });
    resetProviderConfig();
    modelSelectionStore.reset();

    const response = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Hello Ostra" }),
      }),
    );
    const text = JSON.stringify(await response.json());
    assert.equal(text.includes("sk-super-secret"), false);
  });
});

describe("7 — the provider/model catalog still works", () => {
  it("lists providers, models and key presence — without key values", () => {
    setEnv({ OPENROUTER_API_KEY: "sk-catalog-secret", GROQ_API_KEY: "groq-secret" });
    resetProviderConfig();

    const catalog = getModelCatalog();
    const ids = catalog.map((p) => p.id);
    for (const expected of ["openrouter", "groq", "nvidia", "gemini", "mistral", "custom-http"]) {
      assert.ok(ids.includes(expected), `catalog is missing ${expected}`);
    }

    const openrouter = catalog.find((p) => p.id === "openrouter")!;
    assert.equal(openrouter.keyPresent, true);
    assert.ok(openrouter.models.length > 0);
    assert.equal(openrouter.models.some((m) => m.id === "nvidia/nemotron-3.5-lightning:free"), true);
    assert.equal(catalog.find((p) => p.id === "gemini")!.keyPresent, false);

    const serialized = JSON.stringify(catalog);
    assert.equal(serialized.includes("sk-catalog-secret"), false);
    assert.equal(serialized.includes("groq-secret"), false);
  });

  it("still enforces the model allowlist per provider", () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    assert.equal(isModelAllowed("openrouter", "nvidia/nemotron-3.5-lightning:free"), true);
    assert.equal(isModelAllowed("openrouter", "anthropic/claude-3-opus"), false);
    assert.equal(isModelAllowed("openrouter", "../../etc/passwd"), false);
    assert.equal(getModelsForProvider("nvidia").length > 0, true);
  });
});
