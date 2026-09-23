/**
 * Model gateway behavior tests: request construction, response parsing,
 * error classification, timeouts and cancellation — using a stubbed fetch.
 * No real network calls happen in this file.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setEnv } from "../helpers/env.ts";

type FetchStub = (input: string | URL, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;

function stubFetch(stub: FetchStub): void {
  (globalThis as unknown as { fetch: FetchStub }).fetch = stub;
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function captureFetch(responseFactory: (request: CapturedRequest) => Response | Promise<Response>): {
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  stubFetch(async (input, init) => {
    const request: CapturedRequest = { url: String(input), init: init ?? {} };
    requests.push(request);
    return responseFactory(request);
  });
  return { requests };
}

/**
 * A fetch stub that behaves like a real slow endpoint: it honours the
 * AbortSignal, rejecting with an AbortError when the caller aborts.
 */
function hangingFetch(delayMs: number, body: string): FetchStub {
  return (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(body, { status: 200 })), delayMs);
      init?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
}

afterEach(() => {
  (globalThis as unknown as { fetch: FetchStub | typeof fetch }).fetch = originalFetch;
});

const MESSAGES = [
  { role: "system" as const, content: "You are Ostra." },
  { role: "user" as const, content: "Hello Ostra" },
];

describe("openai-compatible gateway", async () => {
  const { callProvider } = await import("@/lib/providers/gateway");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("constructs a correct OpenAI-compatible request", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "test-key" });
    resetProviderConfig();

    const { requests } = captureFetch(() => new Response(
      JSON.stringify({ choices: [{ message: { content: "Hello. I'm Ostra." } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const result = await callProvider(MESSAGES);

    assert.equal(result.content, "Hello. I'm Ostra.");
    assert.equal(result.provider, "openrouter");
    assert.equal(result.usage?.totalTokens, 15);

    const request = requests[0];
    assert.ok(request, "expected a fetch call");
    assert.ok(request.url.endsWith("/chat/completions"), `unexpected url ${request.url}`);
    assert.equal(request.init.method, "POST");
    const headers = request.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer test-key");
    assert.equal(headers["content-type"], "application/json");
    assert.ok(headers["http-referer"], "OpenRouter requires http-referer");
    assert.ok(headers["x-title"], "OpenRouter requires x-title");

    const body = JSON.parse(String(request.init.body));
    assert.equal(body.model, "nvidia/nemotron-3.5-lightning:free");
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, MESSAGES.map((m) => ({ role: m.role, content: m.content })));
    assert.equal(typeof body.temperature, "number");
    assert.equal(typeof body.max_tokens, "number");
  });

  it("classifies HTTP errors and marks 429/5xx retryable", async () => {
    setEnv({ AI_PROVIDER: "groq", AI_MODEL: "openai/gpt-oss-120b", GROQ_API_KEY: "k" });
    resetProviderConfig();

    captureFetch(() => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }));

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string; retryable?: boolean; status?: number }) => {
        assert.equal(error.code, "model_http_error");
        assert.equal(error.retryable, true);
        assert.equal(error.status, 429);
        return true;
      },
    );
  });

  it("treats 401 as a non-retryable auth failure without echoing the key", async () => {
    setEnv({ AI_PROVIDER: "groq", AI_MODEL: "openai/gpt-oss-120b", GROQ_API_KEY: "secret-key-value" });
    resetProviderConfig();

    captureFetch(() => new Response(JSON.stringify({ error: "bad key" }), { status: 401 }));

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string; retryable?: boolean; message?: string }) => {
        assert.equal(error.code, "model_http_error");
        assert.equal(error.retryable, false);
        assert.equal(String(error.message).includes("secret-key-value"), false);
        return true;
      },
    );
  });

  it("rejects when the provider key is missing", async () => {
    setEnv({ AI_PROVIDER: "mistral", AI_MODEL: "mistral-small-latest" });
    resetProviderConfig();

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_misconfigured");
        assert.match(error.message, /key is not configured/);
        return true;
      },
    );
  });

  it("parses tolerant response shapes (OpenAI, plain text, object)", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();

    // 1. Standard OpenAI shape
    captureFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "standard" } }] }), { status: 200 }));
    assert.equal((await callProvider(MESSAGES)).content, "standard");

    // 2. Plain text (non-JSON)
    captureFetch(() => new Response("plain text answer", { status: 200 }));
    assert.equal((await callProvider(MESSAGES)).content, "plain text answer");

    // 3. Ollama-ish / custom JSON shape
    captureFetch(() => new Response(JSON.stringify({ response: "custom shape" }), { status: 200 }));
    assert.equal((await callProvider(MESSAGES)).content, "custom shape");

    // 4. generated_text shape (legacy HF)
    captureFetch(() => new Response(JSON.stringify({ generated_text: "legacy shape" }), { status: 200 }));
    assert.equal((await callProvider(MESSAGES)).content, "legacy shape");
  });

  it("rejects empty model responses", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();

    captureFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }));

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_empty_response");
        return true;
      },
    );
  });

  it("times out and reports model_timeout", async () => {
    // MODEL_TIMEOUT_MS is clamped to a 5s floor by the config resolver, so
    // the stub must hang longer than that for the timeout to fire.
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "k", MODEL_TIMEOUT_MS: "5000" });
    resetProviderConfig();

    stubFetch(hangingFetch(60_000, JSON.stringify({ choices: [{ message: { content: "late" } }] })));

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_timeout");
        return true;
      },
    );
  });

  it("propagates caller cancellation as model_cancelled", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "k", MODEL_TIMEOUT_MS: "5000" });
    resetProviderConfig();

    stubFetch(hangingFetch(500, JSON.stringify({ choices: [{ message: { content: "late" } }] })));

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    await assert.rejects(
      () => callProvider(MESSAGES, { signal: controller.signal }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_cancelled");
        return true;
      },
    );
  });

  it("supports the per-request provider override (Stage 2)", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "or-key", GROQ_API_KEY: "groq-key" });
    resetProviderConfig();

    const { requests } = captureFetch(() => new Response(
      JSON.stringify({ choices: [{ message: { content: "from groq" } }] }),
      { status: 200 },
    ));

    const result = await callProvider(MESSAGES, {
      providerOverride: { providerId: "groq", modelId: "openai/gpt-oss-120b" },
    });

    assert.equal(result.provider, "groq");
    assert.equal(result.model, "openai/gpt-oss-120b");
    const request = requests[0];
    assert.ok(request.url.includes("api.groq.com"));
    const body = JSON.parse(String(request.init.body));
    assert.equal(body.model, "openai/gpt-oss-120b");
    const headers = request.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer groq-key");
  });

  it("rejects an unregistered provider override", async () => {
    setEnv({ AI_PROVIDER: "openrouter", AI_MODEL: "nvidia/nemotron-3.5-lightning:free", OPENROUTER_API_KEY: "k" });
    resetProviderConfig();

    await assert.rejects(
      () => callProvider(MESSAGES, { providerOverride: { providerId: "does-not-exist", modelId: "x" } }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_misconfigured");
        return true;
      },
    );
  });
});

describe("gemini adapter", async () => {
  const { callProvider } = await import("@/lib/providers/gateway");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  it("builds a native Gemini request with systemInstruction and role mapping", async () => {
    setEnv({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-flash-latest", GEMINI_API_KEY: "gem-key" });
    resetProviderConfig();

    const { requests } = captureFetch(() => new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Gemini reply" }], role: "model" } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const result = await callProvider(MESSAGES);
    assert.equal(result.content, "Gemini reply");
    assert.equal(result.usage?.totalTokens, 12);

    const request = requests[0];
    assert.ok(request.url.includes("generativelanguage.googleapis.com"));
    assert.ok(request.url.includes("models/gemini-flash-latest:generateContent"));
    // The key travels in the URL — never in a browser-visible response.
    assert.ok(request.url.includes("key=gem-key"));

    const body = JSON.parse(String(request.init.body));
    assert.ok(body.systemInstruction, "system message should become systemInstruction");
    assert.equal(body.systemInstruction.parts[0].text, "You are Ostra.");
    const roles = body.contents.map((c: { role: string }) => c.role);
    assert.ok(roles.every((role: string) => role === "user" || role === "model"));
    assert.equal(body.contents[body.contents.length - 1].parts[0].text, "Hello Ostra");
    assert.equal(typeof body.generationConfig.maxOutputTokens, "number");
    assert.equal(typeof body.generationConfig.temperature, "number");
  });

  it("merges consecutive same-role messages for Gemini", async () => {
    setEnv({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-flash-latest", GEMINI_API_KEY: "k" });
    resetProviderConfig();

    const { requests } = captureFetch(() => new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      { status: 200 },
    ));

    await callProvider([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "assistant", content: "three" },
    ]);

    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.contents.length, 2);
    assert.equal(body.contents[0].parts[0].text, "one\n\ntwo");
  });

  it("surfaces Gemini API errors safely", async () => {
    setEnv({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-flash-latest", GEMINI_API_KEY: "k" });
    resetProviderConfig();

    captureFetch(() => new Response(
      JSON.stringify({ error: { code: 400, message: "API key not valid", status: "INVALID_ARGUMENT" } }),
      { status: 400 },
    ));

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_http_error");
        return true;
      },
    );
  });

  it("rejects Gemini calls with no key", async () => {
    setEnv({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-flash-latest" });
    resetProviderConfig();

    await assert.rejects(
      () => callProvider(MESSAGES),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "model_misconfigured");
        return true;
      },
    );
  });
});
