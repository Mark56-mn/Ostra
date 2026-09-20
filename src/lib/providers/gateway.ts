/**
 * Provider gateway — the single entry point for all model calls.
 *
 * Flow: AgentRuntime -> gateway.call() -> adapter -> provider API
 *
 * The gateway resolves the active provider from environment, picks the
 * correct adapter (OpenAI-compatible or Gemini), and returns a standard
 * GenerateResult. The runtime never knows which provider is underneath.
 */
import { ModelProviderError } from "@/lib/model/errors";
import type { GenerateOptions, GenerateResult, ModelMessage, ModelProvider } from "@/lib/model/types";
import { isAbortError } from "@/lib/utils";
import { resolveProviderConfig } from "./config";
import { callGemini } from "./gemini-adapter";
import type { ResolvedProvider } from "./types";

const MAX_RESPONSE_CHARS = 200_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Standard gateway call — resolves provider, picks adapter, executes.
 * This is what the agent runtime calls.
 */
export async function callProvider(
  messages: ModelMessage[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const config = resolveProviderConfig();

  if (config.mode === "mock" || !config.provider) {
    return callMock(messages, options);
  }

  if (config.provider.adapter === "gemini") {
    return callGemini(config.provider, messages, options);
  }

  // OpenAI-compatible: OpenRouter, Groq, Mistral, NVIDIA, custom
  return callOpenAICompatible(config.provider, messages, options);
}

/**
 * Build a ModelProvider that satisfies the existing AgentRuntime contract.
 * Delegates to callProvider internally.
 */
export function createGatewayProvider(): ModelProvider {
  const config = resolveProviderConfig();
  const providerName = config.provider?.id ?? "mock";
  const modelName = config.provider?.model ?? "ostra-mock-1";

  return {
    id: providerName,
    model: modelName,
    generate: callProvider,
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter
// ---------------------------------------------------------------------------

async function callOpenAICompatible(
  provider: ResolvedProvider,
  messages: ModelMessage[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  if (!provider.apiKey) {
    throw new ModelProviderError(
      `${provider.name} API key is not configured (${provider.id.toUpperCase()}_API_KEY or AI_API_KEY)`,
      { code: "model_misconfigured", provider: provider.id },
    );
  }

  // Build the endpoint URL
  let url: string;
  if (provider.id === "custom") {
    // Legacy: baseUrl is already the full endpoint
    url = provider.baseUrl;
    if (!url.includes("/chat/completions")) {
      url = url.replace(/\/$/, "") + "/chat/completions";
    }
  } else {
    url = provider.baseUrl.replace(/\/$/, "") + "/chat/completions";
  }

  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, provider.timeoutMs);

  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  const startedAt = Date.now();

  try {
    const body = {
      model: provider.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? provider.temperature,
      max_tokens: options.maxTokens ?? provider.maxTokens,
      stream: false,
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/plain;q=0.9",
    };

    // OpenRouter requires HTTP-Referer and X-Title headers
    if (provider.id === "openrouter") {
      headers["http-referer"] = "https://ostra.app";
      headers["x-title"] = "Ostra";
    }

    if (provider.apiKey) {
      headers.authorization = `Bearer ${provider.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = (await response.text()).slice(0, MAX_RESPONSE_CHARS);

    if (!response.ok) {
      throw new ModelProviderError(`${provider.name} responded with HTTP ${response.status}`, {
        code: "model_http_error",
        provider: provider.id,
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
        detail: raw.slice(0, 400),
      });
    }

    const { content, usage } = parseOpenAIResponse(raw);
    if (!content) {
      throw new ModelProviderError(`${provider.name} returned an empty response`, {
        code: "model_empty_response",
        provider: provider.id,
        retryable: true,
      });
    }

    return {
      content,
      provider: provider.id,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
      usage,
    };
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;

    if (isAbortError(error)) {
      if (timedOut) {
        throw new ModelProviderError(`${provider.name} did not respond within ${provider.timeoutMs} ms`, {
          code: "model_timeout",
          provider: provider.id,
          retryable: true,
        });
      }
      throw new ModelProviderError(`${provider.name} request was cancelled`, {
        code: "model_cancelled",
        provider: provider.id,
      });
    }

    throw new ModelProviderError(`Could not reach ${provider.name}`, {
      code: "model_unreachable",
      provider: provider.id,
      retryable: true,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** Tolerant OpenAI-style response parser. */
function parseOpenAIResponse(raw: string): { content: string | null; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } } {
  const trimmed = raw.trim();
  if (!trimmed) return { content: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { content: trimmed.slice(0, 20_000) };
  }

  // Try standard OpenAI paths
  const candidates: unknown[] = [
    pick(parsed, ["choices", 0, "message", "content"]),
    pick(parsed, ["choices", 0, "delta", "content"]),
    pick(parsed, ["choices", 0, "text"]),
    pick(parsed, ["message", "content"]),
    pick(parsed, ["message"]),
    pick(parsed, ["response"]),
    pick(parsed, ["output"]),
    pick(parsed, ["outputs", 0]),
    pick(parsed, ["content"]),
    pick(parsed, ["text"]),
    pick(parsed, ["generated_text"]),
    pick(parsed, ["result"]),
  ];

  for (const candidate of candidates) {
    const content = coerceText(candidate);
    if (content) {
      return { content, usage: extractUsage(parsed) };
    }
  }

  return { content: null, usage: extractUsage(parsed) };
}

function pick(value: unknown, path: Array<string | number>): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function coerceText(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(coerceText).filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    return coerceText(r.text) ?? coerceText(r.content) ?? coerceText(r.message);
  }
  return null;
}

function extractUsage(parsed: unknown): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined {
  const usage = pick(parsed, ["usage"]) ?? pick(parsed, ["token_usage"]);
  if (!usage || typeof usage !== "object") return undefined;
  const r = usage as Record<string, unknown>;
  const asNum = (key: string) => (typeof r[key] === "number" ? (r[key] as number) : undefined);
  const result = {
    promptTokens: asNum("prompt_tokens") ?? asNum("input_tokens"),
    completionTokens: asNum("completion_tokens") ?? asNum("output_tokens"),
    totalTokens: asNum("total_tokens"),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

// ---------------------------------------------------------------------------
// Mock adapter (delegates to existing MockModelProvider)
// ---------------------------------------------------------------------------

async function callMock(
  messages: ModelMessage[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  // Import dynamically to avoid circular deps
  const { MockModelProvider } = await import("@/lib/model/mock-provider");
  const mock = new MockModelProvider();
  return mock.generate(messages, options);
}
