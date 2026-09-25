/**
 * Route-level integration tests — real route handlers, no HTTP server.
 *
 * Covered: POST /api/chat end-to-end (explicit selection, missing selection,
 * selection rejection), GET /api/health, GET /api/models, POST
 * /api/models/select (secure selection), and method guards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setEnv, flushBootstrap } from "../helpers/env.ts";

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
  const { modelSelectionStore } = await import("@/lib/model-selection/store");

  it("answers end-to-end on the explicitly selected provider and model", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
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
      const payload = (await response.json()) as {
        message: string;
        provider: string;
        model: string;
        mode: string;
        requested: { provider: string; model: string };
        selectionSource: string;
        conversationId: string;
      };
      assert.equal(payload.provider, "openrouter");
      assert.equal(payload.model, "nvidia/nemotron-3.5-lightning:free");
      assert.equal(payload.mode, "live");
      assert.equal(payload.requested.provider, "openrouter");
      assert.equal(payload.selectionSource, "request");
      assert.ok(payload.message.length > 0);
      assert.ok(payload.conversationId.length > 0);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
    }
  });

  it("returns a clear error instead of choosing a model when nothing is selected", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    modelSelectionStore.reset();

    const response = await route.POST(jsonRequest("http://localhost/api/chat", { message: "Hello Ostra" }));
    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(payload.error.code, "model_not_selected");
    assert.match(payload.error.message, /No AI model selected/);
  });

  it("is unaffected by AI_PROVIDER / AI_MODEL", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free" });
    resetProviderConfig();
    modelSelectionStore.reset();

    const response = await route.POST(jsonRequest("http://localhost/api/chat", { message: "Hello Ostra" }));
    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "model_not_selected");
  });

  it("uses the workspace default when the request carries no selection", async () => {
    setEnv({ GROQ_API_KEY: "k" });
    resetProviderConfig();
    // Let the shared bootstrap's async store reset settle, then set the
    // deliberate workspace default the request must fall back to.
    await flushBootstrap();
    modelSelectionStore.setDefault({ provider: "groq", model: "openai/gpt-oss-120b", role: "general" });

    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = (input: string | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "from the workspace default" } }] }), {
          status: 200,
        }),
      );
    };
    try {
      const response = await route.POST(jsonRequest("http://localhost/api/chat", { message: "hi" }));
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { provider: string; model: string; selectionSource: string };
      assert.equal(payload.provider, "groq");
      assert.equal(payload.model, "openai/gpt-oss-120b");
      assert.equal(payload.selectionSource, "workspace");
      assert.ok(calls[0]?.includes("api.groq.com"));
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
    }
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
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/chat", { message: "hi", model: { provider: "openrouter", model: "openai/gpt-4o" } }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "model_not_allowed");
  });

  it("rejects a selection whose provider has no configured key (409)", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" }); // gemini has no key
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/chat", { message: "hi", model: { provider: "gemini", model: "gemini-flash-latest" } }),
    );
    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "key_missing");
  });

  it("rejects a malformed selection shape", async () => {
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/chat", { message: "hi", model: "nvidia/nemotron-3.5-lightning:free" }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "invalid_format");
  });

  it("rejects GET /api/chat", async () => {
    const response = await route.GET();
    assert.equal(response.status, 405);
  });
});

describe("GET /api/health", async () => {
  const route = await import("@/app/api/health/route");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("returns ok/system=ostra without leaking env", async () => {
    setEnv({});
    resetProviderConfig();
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { status: string; system: string; mode: string; provider: string };
    assert.equal(payload.system, "ostra");
    assert.equal(payload.mode, "unselected");
    assert.equal(payload.provider, "none");
  });

  it("reports unconfigured when no provider has a key", async () => {
    setEnv({});
    resetProviderConfig();
    const response = await route.GET();
    const payload = (await response.json()) as { status: string; keyPresent: boolean; model: string };
    assert.equal(payload.status, "unconfigured");
    assert.equal(payload.keyPresent, false);
    assert.equal(payload.model, "");
  });

  it("ignores an invalid AI_PROVIDER instead of erroring on it", async () => {
    setEnv({ AI_PROVIDER: "does-not-exist" });
    resetProviderConfig();
    const response = await route.GET();
    const payload = (await response.json()) as { status: string };
    assert.equal(payload.status, "unconfigured");
  });
});

describe("GET /api/models", async () => {
  const route = await import("@/app/api/models/route");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("serves the allowlisted catalog with key presence but no key values", async () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-secret-123" });
    resetProviderConfig();
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      providers: Array<{ id: string; models: Array<{ id: string }>; keyPresent: boolean }>;
      active: { provider: string; selectableProviders: string[] };
    };
    assert.ok(payload.providers.length >= 5);
    const openrouter = payload.providers.find((p) => p.id === "openrouter");
    assert.equal(openrouter?.keyPresent, true);
    assert.ok((openrouter?.models.length ?? 0) >= 3);
    // No globally active provider — only the deliberate selection counts.
    assert.equal(payload.active.provider, "none");
    assert.ok(payload.active.selectableProviders.includes("openrouter"));
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("sk-or-secret-123"), false);
  });

  it("reports no default selection when nothing is configured", async () => {
    setEnv({});
    resetProviderConfig();
    const response = await route.GET();
    const payload = (await response.json()) as {
      active: { mode: string; provider: string };
      defaultSelection: unknown;
    };
    assert.equal(payload.active.mode, "unselected");
    assert.equal(payload.active.provider, "none");
    assert.equal(payload.defaultSelection, null);
  });

  it("exposes the deliberate workspace default as the fallback selection", async () => {
    const selectRoute = await import("@/app/api/models/select/route");
    setEnv({ OPENROUTER_API_KEY: "k" });
    resetProviderConfig();
    await selectRoute.POST(
      jsonRequest("http://localhost/api/models/select", { provider: "openrouter", model: "qwen/qwen3.8-27b:free" }),
    );
    const response = await route.GET();
    const payload = (await response.json()) as {
      defaultSelection: { provider: string; model: string };
      workspaceDefault: { provider: string; model: string } | null;
    };
    assert.equal(payload.workspaceDefault?.provider, "openrouter");
    assert.equal(payload.workspaceDefault?.model, "qwen/qwen3.8-27b:free");
    assert.equal(payload.defaultSelection.provider, "openrouter");
    assert.equal(payload.defaultSelection.model, "qwen/qwen3.8-27b:free");
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

  it("accepts a custom HTTP selection when an endpoint is configured", async () => {
    setEnv({ MODEL_API_URL: "https://example.test/v1", MODEL_NAME: "Qwen/Qwen3-1.7B" });
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", { provider: "custom-http", model: "Qwen/Qwen3-1.7B" }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { selected: { provider: string; model: string } };
    assert.equal(payload.selected.provider, "custom-http");
    assert.equal(payload.selected.model, "Qwen/Qwen3-1.7B");
  });

  it("rejects a custom HTTP selection with no endpoint configured (409)", async () => {
    setEnv({});
    resetProviderConfig();
    const response = await route.POST(
      jsonRequest("http://localhost/api/models/select", { provider: "custom-http", model: "Qwen/Qwen3-1.7B" }),
    );
    assert.equal(response.status, 409);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "endpoint_missing");
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

  it("GET returns the current workspace selection (null when none is set)", async () => {
    modelSelectionStore.reset();
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { default: unknown; serverDefault: unknown };
    assert.equal(payload.default, null);
    assert.equal(payload.serverDefault, null);
  });
});
