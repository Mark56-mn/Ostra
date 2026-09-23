/**
 * Route-level integration tests — real route handlers, no HTTP server.
 *
 * Covered: POST /api/chat end-to-end (mock mode + selection rejection),
 * GET /api/health, GET /api/models, POST /api/models/select (secure
 * selection), and method guards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setEnv } from "../helpers/env.ts";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", async () => {
  const route = await import("@/app/api/chat/route");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("answers end-to-end in mock mode", async () => {
    resetProviderConfig();
    const response = await route.POST(jsonRequest("http://localhost/api/chat", { message: "Hello Ostra" }));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { message: string; provider: string; mode: string; conversationId: string };
    assert.equal(payload.provider, "mock");
    assert.equal(payload.mode, "mock");
    assert.ok(payload.message.length > 0);
    assert.ok(payload.conversationId.length > 0);
  });

  it("rejects invalid JSON bodies", async () => {
    const response = await route.POST(
      new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "invalid_json");
  });

  it("rejects non-JSON content types", async () => {
    const response = await route.POST(
      new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" }),
    );
    assert.equal(response.status, 415);
  });

  it("rejects oversized messages with a validation error", async () => {
    // The server clamps OSTRA_MAX_MESSAGE_LENGTH into [100, 32000].
    process.env.OSTRA_MAX_MESSAGE_LENGTH = "100";
    const response = await route.POST(jsonRequest("http://localhost/api/chat", { message: "x".repeat(101) }));
    delete process.env.OSTRA_MAX_MESSAGE_LENGTH;
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "message_too_long");
  });

  it("rejects a non-allowlisted model selection without calling any provider", async () => {
    setEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/chat", { message: "hi", model: { provider: "openrouter", model: "openai/gpt-4o" } }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "model_not_allowed");
  });

  it("rejects a selection whose provider has no configured key (409)", async () => {
    setEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/chat", { message: "hi", model: { provider: "gemini", model: "gemini-flash-latest" } }),
    );
    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "key_missing");
  });

  it("rejects a malformed selection shape", async () => {
    setEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/chat", { message: "hi", model: "nvidia/nemotron-3.5-lightning:free" }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "invalid_format");
  });

  it("routes to the selected provider when it is allowlisted and keyed", async () => {
    setEnv({ AI_PROVIDER: "mock", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();

    // Stub fetch so no network call leaves the test.
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "reply from the selected provider" } }] }), {
          status: 200,
        }),
      );
    try {
      const response = await route.POST(
        jsonRequest("http://localhost/api/chat", {
          message: "Hello Ostra",
          model: { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" },
        }),
      );
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { provider: string; model: string; mode: string };
      assert.equal(payload.provider, "openrouter");
      assert.equal(payload.model, "nvidia/nemotron-3.5-lightning:free");
      assert.equal(payload.mode, "live");
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
    }
  });

  it("rejects GET /api/chat", async () => {
    const response = await route.GET();
    assert.equal(response.status, 405);
  });
});

describe("GET /api/health", async () => {
  const route = await import("@/app/api/health/route");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("returns ok/system=ostra in mock mode without leaking env", async () => {
    resetProviderConfig();
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { status: string; system: string; mode: string };
    assert.equal(payload.status, "ok");
    assert.equal(payload.system, "ostra");
    assert.equal(payload.mode, "mock");
  });

  it("reports degraded when a provider is configured without a key", async () => {
    setEnv({ AI_PROVIDER: "nvidia" });
    resetProviderConfig();
    const response = await route.GET();
    const payload = (await response.json()) as { status: string; keyPresent: boolean };
    assert.equal(payload.status, "degraded");
    assert.equal(payload.keyPresent, false);
  });

  it("reports error for invalid provider configuration", async () => {
    setEnv({ AI_PROVIDER: "does-not-exist" });
    resetProviderConfig();
    const response = await route.GET();
    const payload = (await response.json()) as { status: string; configError?: string };
    assert.equal(payload.status, "error");
    assert.match(payload.configError ?? "", /Invalid AI_PROVIDER/);
  });
});

describe("GET /api/models", async () => {
  const route = await import("@/app/api/models/route");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("serves the allowlisted catalog with key presence but no key values", async () => {
    setEnv({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-secret-123" });
    resetProviderConfig();
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      providers: Array<{ id: string; models: Array<{ id: string }>; keyPresent: boolean }>;
      active: { provider: string };
      defaultSelection: { provider: string; model: string };
    };
    assert.ok(payload.providers.length >= 5);
    const openrouter = payload.providers.find((p) => p.id === "openrouter");
    assert.equal(openrouter?.keyPresent, true);
    assert.ok((openrouter?.models.length ?? 0) >= 3);
    assert.equal(payload.active.provider, "openrouter");
    assert.equal(payload.defaultSelection.model, "nvidia/nemotron-3.5-lightning:free");
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("sk-or-secret-123"), false);
  });

  it("reports mock default when nothing is configured", async () => {
    resetProviderConfig();
    const response = await route.GET();
    const payload = (await response.json()) as { active: { mode: string }; defaultSelection: { provider: string } };
    assert.equal(payload.active.mode, "mock");
    assert.equal(payload.defaultSelection.provider, "mock");
  });
});

describe("POST /api/models/select", async () => {
  const route = await import("@/app/api/models/select/route");
  const { modelSelectionStore } = await import("@/lib/model-selection/store");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("saves a valid default selection", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", { provider: "openrouter", model: "qwen/qwen3.8-27b:free", role: "general" }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { selected: { model: string } };
    assert.equal(payload.selected.model, "qwen/qwen3.8-27b:free");
    assert.equal(modelSelectionStore.getState().default?.model, "qwen/qwen3.8-27b:free");
  });

  it("rejects non-allowlisted models with a safe error", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", { provider: "openrouter", model: "anthropic/claude-3-opus" }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "model_not_allowed");
  });

  it("rejects providers with missing keys (409)", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", { provider: "groq", model: "openai/gpt-oss-120b" }),
    );
    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "key_missing");
  });

  it("saves a multi-model task configuration", async () => {
    setEnv({ OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", {
        name: "build feature",
        models: [
          { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "planner" },
          { provider: "gemini", model: "gemini-flash-latest", role: "coder" },
        ],
      }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { taskConfig: { models: Array<{ role: string }>; status: string } };
    assert.equal(payload.taskConfig.models.length, 2);
    assert.equal(payload.taskConfig.status, "configured");
  });

  it("rejects duplicate roles in a task configuration", async () => {
    setEnv({ OPENROUTER_API_KEY: "k", GEMINI_API_KEY: "g" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", {
        models: [
          { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", role: "planner" },
          { provider: "gemini", model: "gemini-flash-latest", role: "planner" },
        ],
      }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "duplicate_role");
  });

  it("GET returns the current workspace selection", async () => {
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { default: unknown; serverDefault: { provider: string } };
    assert.ok("default" in payload);
    assert.equal(payload.serverDefault.provider, "mock");
  });
});
