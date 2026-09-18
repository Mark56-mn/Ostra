/**
 * Configurable HTTP model provider — the bridge to the experimental model.
 *
 * The model does not run inside the web app. This provider is called from the
 * server (route handler → agent runtime → provider), so MODEL_API_KEY never
 * reaches the browser.
 *
 * Response parsing is intentionally tolerant: OpenAI-compatible shapes plus
 * the flat shapes commonly returned by small self-hosted/Kaggle servers.
 */
import { isAbortError } from "@/lib/utils";
import { ModelConfigError, ModelProviderError } from "./errors";
import type { GenerateOptions, GenerateResult, GenerateUsage, ModelConfig, ModelMessage, ModelProvider } from "./types";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RESPONSE_CHARS = 200_000;

export class HttpModelProvider implements ModelProvider {
  readonly id = "http";
  private readonly config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  get model(): string {
    return this.config.modelName;
  }

  async generate(messages: ModelMessage[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const url = this.resolveUrl();
    const controller = new AbortController();
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);

    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true });

    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, options)),
        signal: controller.signal,
        cache: "no-store",
      });

      const raw = (await response.text()).slice(0, MAX_RESPONSE_CHARS);

      if (!response.ok) {
        throw new ModelProviderError(`Model endpoint responded with status ${response.status}`, {
          code: "model_http_error",
          provider: this.id,
          status: response.status,
          retryable: RETRYABLE_STATUS.has(response.status),
          detail: raw.slice(0, 400),
        });
      }

      const { content, usage } = parseModelResponse(raw);
      if (!content) {
        throw new ModelProviderError("Model endpoint returned an empty response", {
          code: "model_empty_response",
          provider: this.id,
          retryable: true,
        });
      }

      return {
        content,
        provider: this.id,
        model: this.config.modelName,
        latencyMs: Date.now() - startedAt,
        usage,
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;

      if (isAbortError(error)) {
        if (timedOut) {
          throw new ModelProviderError(`The model endpoint did not answer within ${this.config.timeoutMs} ms`, {
            code: "model_timeout",
            provider: this.id,
            retryable: true,
          });
        }
        throw new ModelProviderError("Model request was cancelled", {
          code: "model_cancelled",
          provider: this.id,
        });
      }

      throw new ModelProviderError("Could not reach the model endpoint", {
        code: "model_unreachable",
        provider: this.id,
        retryable: true,
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
  }

  private resolveUrl(): string {
    const url = this.config.apiUrl;
    if (!url) {
      throw new ModelConfigError("MODEL_API_URL is not configured", { provider: this.id });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ModelConfigError("MODEL_API_URL is not a valid absolute URL", {
        provider: this.id,
        detail: url,
      });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ModelConfigError("MODEL_API_URL must use http or https", { provider: this.id });
    }
    return parsed.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/plain;q=0.9",
      "user-agent": "ostra-web/0.1 (+server-side model adapter)",
    };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private buildBody(messages: ModelMessage[], options: GenerateOptions) {
    const base = {
      model: this.config.modelName,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 768,
      stream: false,
    };

    if (this.config.apiFormat === "simple") {
      const lastUser = [...messages].reverse().find((message) => message.role === "user");
      return { ...base, prompt: lastUser?.content ?? "" };
    }

    return base;
  }
}

/** Tolerant response reader shared with any future HTTP-ish provider. */
export function parseModelResponse(raw: string): { content: string | null; usage?: GenerateUsage } {
  const trimmed = raw.trim();
  if (!trimmed) return { content: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Some endpoints answer with plain text instead of JSON.
    return { content: trimmed.slice(0, 20_000) };
  }

  const candidates: unknown[] = [
    pick(parsed, ["choices", 0, "message", "content"]),
    pick(parsed, ["choices", 0, "delta", "content"]),
    pick(parsed, ["choices", 0, "text"]),
    pick(parsed, ["message", "content"]),
    pick(parsed, ["message"]),
    pick(parsed, ["response"]),
    pick(parsed, ["output"]),
    pick(parsed, ["outputs", 0]),
    pick(parsed, ["output", 0, "content", 0, "text"]),
    pick(parsed, ["content"]),
    pick(parsed, ["text"]),
    pick(parsed, ["generated_text"]),
    pick(parsed, ["completion"]),
    pick(parsed, ["result"]),
    pick(parsed, ["data", 0, "generated_text"]),
    pick(parsed, ["data", 0]),
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
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    const parts = value.map(coerceText).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return coerceText(record.text) ?? coerceText(record.content) ?? coerceText(record.message);
  }

  return null;
}

function extractUsage(parsed: unknown): GenerateUsage | undefined {
  const usage = pick(parsed, ["usage"]) ?? pick(parsed, ["token_usage"]);
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const asNumber = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : undefined);
  const result: GenerateUsage = {
    promptTokens: asNumber("prompt_tokens") ?? asNumber("input_tokens"),
    completionTokens: asNumber("completion_tokens") ?? asNumber("output_tokens"),
    totalTokens: asNumber("total_tokens"),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}
