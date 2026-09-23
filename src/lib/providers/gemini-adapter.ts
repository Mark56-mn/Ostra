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
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args?: Record<string, unknown> } }
    | { functionResponse: { name: string; response: unknown } }
  >;
}

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: Array<{ functionDeclarations: Array<{ name: string; description?: string; parameters?: unknown }> }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  systemInstruction?: { parts: Array<{ text: string }> };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string } | { functionCall?: { name: string; args?: Record<string, unknown> } }>;
      role?: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: unknown; message?: string; status?: string };
  promptFeedback?: { blockReason?: string };
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
    const functionTools = options.functionTools ?? [];

    const declarations = functionTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const url = `${provider.baseUrl}/models/${provider.model}:generateContent?key=${provider.apiKey}`;
    let bodyContents = contents;
    const executedToolIds: string[] = [];
    let lastUsage: GenerateUsage | undefined;
    const MAX_HOPS = 8;

    for (let hop = 0; ; hop++) {
      const body: GeminiRequest = { contents: bodyContents };
      if (systemInstruction) body.systemInstruction = systemInstruction;
      if (declarations.length > 0) body.tools = [{ functionDeclarations: declarations }];
      body.generationConfig = {
        temperature: options.temperature ?? provider.temperature,
        maxOutputTokens: options.maxTokens ?? provider.maxTokens,
      };

      const parsed = await postGenerateContent(provider, url, body, () => {
        timedOut = true;
        controller.abort();
      }, options.signal, controller);

      if (parsed.usageMetadata) {
        lastUsage = {
          promptTokens: parsed.usageMetadata.promptTokenCount,
          completionTokens: parsed.usageMetadata.candidatesTokenCount,
          totalTokens: parsed.usageMetadata.totalTokenCount,
        };
      }

      const parts = parsed.candidates?.[0]?.content?.parts ?? [];
      const calls = parts
        .map((p) => ("functionCall" in p ? p.functionCall : null))
        .filter((c): c is { name: string; args?: Record<string, unknown> } => c !== null);

      // No function calls → final answer path.
      if (calls.length === 0) {
        const text = parts.map((p) => ("text" in p ? p.text ?? "" : "")).join("").trim();
        if (text.length === 0) {
          throw new ModelProviderError("Gemini returned an empty response", {
            code: "model_empty_response",
            provider: "gemini",
            retryable: true,
          });
        }

        const toolUsage = executedToolIds.length > 0 ? { clientToolCalls: [...executedToolIds], serverToolSteps: 0, sources: [] } : undefined;
        return {
          content: text,
          provider: "gemini",
          model: provider.model,
          latencyMs: Date.now() - startedAt,
          ...(lastUsage ? { usage: lastUsage } : {}),
          ...(toolUsage ? { toolUsage } : {}),
        };
      }

      // The model wants tools: execute each through Ostra's pipeline and
      // continue the conversation with the results.
      const modelTurn = { role: "model" as const, parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args ?? {} } })) };
      const responses: GeminiContent[] = [];
      for (const call of calls) {
        const outcome = await runOstraToolGemini(call, functionTools);
        if (outcome.toolId) executedToolIds.push(outcome.toolId);
        responses.push({
          role: "user" as const,
          parts: [{ functionResponse: { name: call.name, response: outcome.result } }],
        });
      }
      bodyContents = [...bodyContents, modelTurn, ...responses];

      if (hop >= MAX_HOPS) {
        // Honest stop: never fabricate a completed answer past the budget.
        const toolUsage = executedToolIds.length > 0 ? { clientToolCalls: [...executedToolIds], serverToolSteps: 0, sources: [] } : undefined;
        const note = "[Ostra: tool-call budget of " + MAX_HOPS + " steps was reached before a final answer was produced.]";
        return {
          content: note,
          provider: "gemini",
          model: provider.model,
          latencyMs: Date.now() - startedAt,
          ...(lastUsage ? { usage: lastUsage } : {}),
          ...(toolUsage ? { toolUsage } : {}),
        };
      }
    }
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

  // Gemini requires alternating user/model turns. Merge consecutive same-role
  // text-only turns; tool turns are already structured and never merged.
  const merged: GeminiContent[] = [];
  for (const content of contents) {
    const last = merged[merged.length - 1];
    const firstPart = content.parts[0];
    const firstIsText = firstPart && "text" in firstPart;
    if (last && last.role === content.role && firstIsText && last.parts[0] && "text" in last.parts[0]) {
      last.parts[0].text += "\n\n" + firstPart.text;
    } else {
      merged.push({ ...content });
    }
  }

  // Ensure the conversation starts with a user message.
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", parts: [{ text: "." }] });
  }

  return { contents: merged, systemInstruction };
}

/**
 * One Gemini round-trip: maps HTTP/JSON errors to ModelProviderError and
 * handles timeout/abort classification. Extracted so the tool loop can call
 * it repeatedly without duplicating error handling.
 */
async function postGenerateContent(
  provider: ResolvedProvider,
  url: string,
  body: GeminiRequest,
  _markTimeout: () => void,
  signal: AbortSignal | undefined,
  controller: AbortController,
): Promise<GeminiResponse> {
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

  void signal;
  return parsed;
}

interface GeminiToolOutcome {
  result: Record<string, unknown>;
  /** Ostra tool id that ran (for transparency), if a real tool executed. */
  toolId?: string;
}

/**
 * Execute one model-requested function call through Ostra's full tool
 * pipeline. Never throws: failures become structured functionResponse payloads
 * the model can reason about. Mirrors the gateway's runOstraTool contract.
 */
async function runOstraToolGemini(
  call: { name: string; args?: Record<string, unknown> },
  functionTools: NonNullable<GenerateOptions["functionTools"]>,
): Promise<GeminiToolOutcome> {
  const attachment = functionTools.find((t) => t.name === call.name);
  if (!attachment) {
    return { result: { ok: false, error: "unknown_tool", message: "This tool is not available to Ostra." } };
  }
  try {
    const tools = await import("@/lib/tools");
    const result = await tools.executeTool(attachment.toolId, call.args ?? {}, { userApproved: false });
    return { result: { ok: true, output: result.output ?? "" }, toolId: attachment.toolId };
  } catch (error) {
    const tools = await import("@/lib/tools");
    if (error instanceof tools.ToolError) {
      return { result: { ok: false, error: error.code, message: error.message } };
    }
    return { result: { ok: false, error: "tool_execution_failed", message: "Tool execution failed." } };
  }
}
