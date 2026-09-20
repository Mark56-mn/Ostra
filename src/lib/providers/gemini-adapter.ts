/**
 * Google Gemini API adapter.
 *
 * Gemini uses a different request/response shape from OpenAI:
 *   POST /v1beta/models/{model}:generateContent?key={apiKey}
 *
 * This adapter converts the standard ModelMessage[] format to Gemini's
 * format and parses the response back.
 */
import { ModelProviderError } from "@/lib/model/errors";
import { isAbortError } from "@/lib/utils";
import type { GenerateOptions, GenerateResult, GenerateUsage, ModelMessage } from "@/lib/model/types";
import type { ResolvedProvider } from "./types";

const MAX_RESPONSE_CHARS = 200_000;

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  systemInstruction?: { parts: Array<{ text: string }> };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }>; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

export async function callGemini(
  provider: ResolvedProvider,
  messages: ModelMessage[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  if (!provider.apiKey) {
    throw new ModelProviderError("Gemini API key is not configured (GEMINI_API_KEY)", {
      code: "model_misconfigured",
      provider: "gemini",
    });
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
    const { contents, systemInstruction } = convertMessages(messages);
    const url = `${provider.baseUrl}/models/${provider.model}:generateContent?key=${provider.apiKey}`;

    const body: GeminiRequest = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    body.generationConfig = {
      temperature: options.temperature ?? provider.temperature,
      maxOutputTokens: options.maxTokens ?? provider.maxTokens,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = (await response.text()).slice(0, MAX_RESPONSE_CHARS);

    if (!response.ok) {
      let detail = raw.slice(0, 400);
      try {
        const parsed: GeminiResponse = JSON.parse(raw);
        if (parsed.error?.message) detail = parsed.error.message;
      } catch { /* use raw */ }

      throw new ModelProviderError(`Gemini responded with HTTP ${response.status}: ${detail}`, {
        code: "model_http_error",
        provider: "gemini",
        status: response.status,
        retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
      });
    }

    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ModelProviderError("Gemini returned invalid JSON", {
        code: "model_empty_response",
        provider: "gemini",
        retryable: true,
      });
    }

    if (parsed.error) {
      throw new ModelProviderError(`Gemini error: ${parsed.error.message ?? "unknown"}`, {
        code: "model_http_error",
        provider: "gemini",
        retryable: false,
      });
    }

    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || text.trim().length === 0) {
      throw new ModelProviderError("Gemini returned an empty response", {
        code: "model_empty_response",
        provider: "gemini",
        retryable: true,
      });
    }

    const usage: GenerateUsage | undefined = parsed.usageMetadata
      ? {
          promptTokens: parsed.usageMetadata.promptTokenCount,
          completionTokens: parsed.usageMetadata.candidatesTokenCount,
          totalTokens: parsed.usageMetadata.totalTokenCount,
        }
      : undefined;

    return {
      content: text.trim(),
      provider: "gemini",
      model: provider.model,
      latencyMs: Date.now() - startedAt,
      usage,
    };
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;

    if (isAbortError(error)) {
      if (timedOut) {
        throw new ModelProviderError(`Gemini did not respond within ${provider.timeoutMs} ms`, {
          code: "model_timeout",
          provider: "gemini",
          retryable: true,
        });
      }
      throw new ModelProviderError("Gemini request was cancelled", {
        code: "model_cancelled",
        provider: "gemini",
      });
    }

    throw new ModelProviderError("Could not reach Gemini", {
      code: "model_unreachable",
      provider: "gemini",
      retryable: true,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Convert ModelMessage[] to Gemini's contents format.
 * Extracts the system message as a systemInstruction.
 */
function convertMessages(messages: ModelMessage[]): {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
} {
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemInstruction = { parts: [{ text: message.content }] };
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  // Gemini requires alternating user/model turns. Merge consecutive same-role messages.
  const merged: GeminiContent[] = [];
  for (const content of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === content.role) {
      last.parts[0].text += "\n\n" + content.parts[0].text;
    } else {
      merged.push({ ...content });
    }
  }

  // Ensure the conversation starts with a user message.
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", parts: [{ text: "." }] });
  }

  return { contents: merged.length > 0 ? merged : [{ role: "user", parts: [{ text: "." }] }], systemInstruction };
}
