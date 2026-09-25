/**
 * Provider gateway — the single entry point for all model calls.
 *
 * Flow: AgentRuntime -> gateway.call() -> adapter -> provider API
 *
 * The gateway routes on the EXPLICIT selection it is handed
 * (`options.providerOverride`, already validated against the server catalog
 * by /api/chat). There is no env-derived default provider/model and no
 * fallback provider: if no selection is present the call fails with a clear
 * "no model selected" error rather than silently using another provider.
 * It picks the correct adapter (OpenAI-compatible or Gemini) and returns a
 * standard GenerateResult. The runtime never knows which provider is underneath.
 *
 * Stage 2 tool-call handling (the complete loop):
 *
 *   model → tool call → (server tool: OpenRouter executes; native tool:
 *   Ostra executes through the tool pipeline) → tool result → model
 *   continues → final response
 *
 * - `options.tools` (openrouter:* types) attach to the request body; OpenRouter
 *   runs the server-tool agent loop internally and Ostra parses the final
 *   message including content parts, url_citation annotations and
 *   usage.server_tool_use accounting.
 * - `options.functionTools` are exposed as OpenAI-style functions; the model's
 *   `tool_calls` are executed server-side through Ostra's permission pipeline
 *   and the conversation continues until the model answers or the hop budget
 *   ends. Approval-gated tools are NEVER self-approved by the model: the
 *   pipeline runs with userApproved:false and refusals are fed back as tool
 *   results, so the model can explain the refusal instead of pretending.
 */
import { ModelProviderError } from "@/lib/model/errors";
import type {
  FunctionToolAttachment,
  GenerateOptions,
  GenerateResult,
  ModelMessage,
  ModelProvider,
} from "@/lib/model/types";
import type { ToolSource, ToolUsage } from "@/lib/model/types";
import { isAbortError } from "@/lib/utils";
import { readEnv } from "./env";
import { getRunSettings } from "./config";
import { callGemini } from "./gemini-adapter";
import { CUSTOM_HTTP_ID, getProviderBaseUrl, getProviderDefinition } from "./registry";
import { parseOpenAIChatResponse } from "./openai-parser";
import type { ResolvedProvider } from "./types";

const MAX_RESPONSE_CHARS = 200_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
/** OpenRouter server-tool step budget cap (API maximum). */
const MAX_SERVER_TOOL_CALLS = 30;
/** Client tool-call loop hop budget (function tools). */
const MAX_FUNCTION_TOOL_HOPS = 8;
/** A single tool result is truncated before it re-enters model context. */
const MAX_TOOL_RESULT_CHARS = 4_000;

/** Wire message: ModelMessage plus the tool-loop extensions. */
interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/**
 * Standard gateway call — resolves provider, picks adapter, executes.
 * This is what the agent runtime calls.
 */
export async function callProvider(
  messages: ModelMessage[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  // No selection: refuse rather than quietly routing to some other provider.
  if (!options.providerOverride) {
    throw new ModelProviderError(
      "No AI model selected. Select a provider and model before starting a chat.",
      { code: "model_not_selected", provider: "none" },
    );
  }

  // "mock" is only reachable when it is explicitly selected — it is never an
  // implicit fallback for a missing selection.
  if (options.providerOverride.providerId === "mock") {
    return callMock(messages, options);
  }

  const provider = resolveOverrideProvider(options.providerOverride.providerId, options.providerOverride.modelId);
  if (!provider) {
    throw new ModelProviderError("Requested provider is not registered", {
      code: "model_misconfigured",
      provider: "unknown",
    });
  }
  if (provider.id === CUSTOM_HTTP_ID && !provider.baseUrl) {
    throw new ModelProviderError(
      "The custom HTTP endpoint is not configured. Set MODEL_API_URL on the server to an OpenAI-compatible endpoint.",
      { code: "model_misconfigured", provider: provider.id },
    );
  }
  // A custom endpoint may legitimately be keyless (a local llama.cpp server, a
  // tunnel) — for it the endpoint is the requirement, not a bearer token.
  if (provider.id !== CUSTOM_HTTP_ID && !provider.apiKey) {
    throw new ModelProviderError(`${provider.name} API key is not configured`, {
      code: "model_misconfigured",
      provider: provider.id,
    });
  }

  if (provider.adapter === "gemini") return callGemini(provider, messages, options);
  return callOpenAICompatible(provider, messages, options);
}

/**
 * Resolve a validated explicit selection into a concrete provider config.
 *
 * The provider id and model come from the selection; only the credential and
 * the endpoint come from the environment. Returns null when the provider id
 * is not registered.
 */
function resolveOverrideProvider(providerId: string, modelId: string): ResolvedProvider | null {
  const definition = getProviderDefinition(providerId);
  if (!definition) return null;
  const run = getRunSettings();
  return {
    id: definition.id,
    name: definition.name,
    baseUrl: getProviderBaseUrl(definition),
    apiKey: readEnv(definition.keyEnvVar),
    model: modelId,
    adapter: definition.adapter,
    timeoutMs: run.timeoutMs,
    maxTokens: run.maxTokens,
    temperature: run.temperature,
  };
}

/**
 * Build a ModelProvider that satisfies the existing AgentRuntime contract.
 * Delegates to callProvider internally; the selection is supplied per call.
 */
export function createGatewayProvider(): ModelProvider {
  return {
    id: "selection",
    model: "per-request",
    generate: callProvider,
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter (OpenRouter, Groq, Mistral, NVIDIA, custom)
// ---------------------------------------------------------------------------

async function callOpenAICompatible(
  provider: ResolvedProvider,
  messages: ModelMessage[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  if (!provider.apiKey && provider.id !== CUSTOM_HTTP_ID) {
    throw new ModelProviderError(`${provider.name} API key is not configured`, {
      code: "model_misconfigured",
      provider: provider.id,
    });
  }

  const startedAt = Date.now();
  const serverTools = options.tools ?? [];
  const functionTools = options.functionTools ?? [];

  // Budgets: server-tool steps clamp to the API max; function-tool hops are
  // bounded so a misbehaving model cannot loop forever.
  const maxServerSteps = Math.min(Math.max(options.maxToolCalls ?? 5, 1), MAX_SERVER_TOOL_CALLS);
  const maxHops = Math.min(Math.max(options.maxToolCalls ?? 6, 1), MAX_FUNCTION_TOOL_HOPS);

  // Tool-call loop state.
  let wire: WireMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (functionTools.length > 0) {
    wire = [{ role: "system", content: functionToolSystemPrompt() }, ...wire];
  }
  const executedToolIds: string[] = [];
  let serverToolSteps = 0;
  let multiToolCalls = 0;
  const citations: ToolSource[] = [];
  let lastUsage: ReturnType<typeof parseOpenAIChatResponse>["usage"];
  let lastAssistant = "";

  // V1: the only approval signal for approval-gated tools — ids the user
  // explicitly confirmed in the validated request body. The model can never
  // add to this list.
  const approved = new Set(options.approvedToolIds ?? []);

  // Safe, secret-free execution trace for debugging the tool loop. Enable
  // with OSTRA_TOOL_DEBUG=1; never logs keys, tokens, or full results.
  const debug = readEnv("OSTRA_TOOL_DEBUG") === "1";
  const trace = (event: string, data: Record<string, unknown> = {}): void => {
    if (!debug) return;
    console.log(`[ostra:tool-loop] ${event}`, JSON.stringify(data));
  };

  trace("request", {
    provider: provider.id,
    model: provider.model,
    serverTools: serverTools.map((t) => t.type),
    functionTools: functionTools.map((t) => t.name),
  });

  for (let hop = 0; hop <= maxHops; hop++) {
    const raw = await postChatCompletion(provider, wire, options, {
      serverTools,
      functionTools,
      serverBudget: maxServerSteps,
    });

    const parsed = parseOpenAIChatResponse(raw);
    if (parsed.usage) lastUsage = parsed.usage;
    serverToolSteps += parsed.usage?.serverToolSteps ?? 0;
    for (const citation of parsed.citations) {
      if (!citations.some((c) => c.url === citation.url)) citations.push(citation);
    }

    // No tool calls → this is the final answer.
    if (parsed.toolCalls.length === 0) {
      if (!parsed.content) {
        throw new ModelProviderError(`${provider.name} returned an empty response`, {
          code: "model_empty_response",
          provider: provider.id,
          retryable: true,
        });
      }
      trace("final_response", { hops: hop + 1, toolsUsed: executedToolIds, contentBytes: parsed.content.length });
      return finishResult(provider, options, parsed.content, startedAt, {
        executedToolIds,
        serverToolSteps,
        multiToolCalls,
        citations,
        usage: lastUsage,
      });
    }

    // The model wants tools. Execute each through Ostra's pipeline and
    // continue the conversation with the results.
    lastAssistant = parsed.content ?? lastAssistant;
    if (parsed.toolCalls.length > 1) multiToolCalls += parsed.toolCalls.length - 1;
    const assistantMsg: WireMessage = {
      role: "assistant",
      ...(parsed.content ? { content: parsed.content } : { content: null }),
      tool_calls: parsed.toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    };
    const toolMsgs: WireMessage[] = [];
    for (const call of parsed.toolCalls) {
      const attachment = functionTools.find((t) => t.name === call.name);
      if (!attachment) {
        trace("tool_call_rejected", { name: call.name, reason: "not_attached" });
        toolMsgs.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: "unknown_tool", message: "This tool is not available to Ostra." }),
        });
        continue;
      }
      executedToolIds.push(attachment.toolId);
      trace("tool_call_received", { name: call.name, toolId: attachment.toolId, argsBytes: call.arguments.length });
      const outcome = await runOstraTool(attachment, call.arguments, { userApproved: approved.has(attachment.toolId) });
      trace("tool_result_returned", { toolId: attachment.toolId, executed: outcome.includes('"state":"executed"'), bytes: outcome.length });
      toolMsgs.push({ role: "tool", tool_call_id: call.id, content: outcome });
    }
    wire = [...wire, assistantMsg, ...toolMsgs];
    trace("continuation", { hop: hop + 1, wireMessages: wire.length });

    // Budget exhausted with the model still calling tools: return what we
    // have plus an honest note — never fabricate a completed answer.
    if (hop === maxHops) {
      const note =
        lastAssistant.trim().length > 0
          ? `${lastAssistant.trim()}\n\n[Ostra: tool-call budget of ${maxHops} steps was reached before the model produced a final answer.]`
          : `[Ostra: tool-call budget of ${maxHops} steps was reached before the model produced a final answer.]`;
      return finishResult(provider, options, note, startedAt, {
        executedToolIds,
        serverToolSteps,
        multiToolCalls,
        citations,
        usage: lastUsage,
      });
    }
  }

  // Unreachable (loop returns on every path) — kept for type soundness.
  throw new ModelProviderError(`${provider.name} tool-call loop did not converge`, {
    code: "model_http_error",
    provider: provider.id,
  });
}

/** One provider round-trip with timeout/abort handling and error mapping. */
async function postChatCompletion(
  provider: ResolvedProvider,
  wire: WireMessage[],
  options: GenerateOptions,
  attachments: {
    serverTools: NonNullable<GenerateOptions["tools"]>;
    functionTools: FunctionToolAttachment[];
    serverBudget: number;
  },
): Promise<string> {
  let url: string;
  if (provider.id === CUSTOM_HTTP_ID) {
    // The configured custom endpoint is a base URL; append the OpenAI-
    // compatible path exactly once.
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

  try {
    // Server tools (openrouter:*) and function tools (type:"function") have
    // different wire shapes; they can coexist in one request.
    const serverSpecs = attachments.serverTools.map((t) =>
      attachments.functionTools.length > 0 || Object.keys(t).length > 1
        ? { ...t }
        : { type: t.type },
    );
    const functionSpecs = attachments.functionTools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const body: Record<string, unknown> = {
      model: provider.model,
      messages: wire,
      temperature: options.temperature ?? provider.temperature,
      max_tokens: options.maxTokens ?? provider.maxTokens,
      stream: false,
      ...(serverSpecs.length > 0 || functionSpecs.length > 0
        ? { tools: [...serverSpecs, ...functionSpecs] }
        : {}),
      ...(functionSpecs.length > 0 ? { tool_choice: "auto" } : {}),
      // OpenRouter server-tool step budget (API max 30).
      ...(serverSpecs.length > 0 ? { max_tool_calls: attachments.serverBudget } : {}),
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

    return raw;
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

interface FinishContext {
  executedToolIds: string[];
  serverToolSteps: number;
  multiToolCalls: number;
  citations: ToolSource[];
  usage?: ReturnType<typeof parseOpenAIChatResponse>["usage"];
}

function finishResult(
  provider: ResolvedProvider,
  options: GenerateOptions,
  content: string,
  startedAt: number,
  ctx: FinishContext,
): GenerateResult {
  const usage = ctx.usage
    ? {
        promptTokens: ctx.usage.promptTokens,
        completionTokens: ctx.usage.completionTokens,
        totalTokens: ctx.usage.totalTokens,
      }
    : undefined;

  const toolUsage: ToolUsage | undefined =
    ctx.executedToolIds.length > 0 || ctx.serverToolSteps > 0 || ctx.citations.length > 0
      ? {
          clientToolCalls: [...ctx.executedToolIds],
          serverToolSteps: ctx.serverToolSteps,
          sources: ctx.citations,
        }
      : undefined;
  void ctx.multiToolCalls; // tracked for future per-step tracing

  return {
    content,
    provider: provider.id,
    model: provider.model,
    latencyMs: Date.now() - startedAt,
    ...(usage ? { usage } : {}),
    ...(toolUsage ? { toolUsage } : {}),
    // options kept in scope for future per-call tracing; avoids unused param.
    ...(options.signal ? {} : {}),
  };
}

/**
 * Execute one Ostra tool for the model's tool call — through the FULL
 * permission pipeline (registry → config → compatibility → permissions →
 * schema validation → adapter). The model can never self-approve:
 * userApproved is always false here. Failures become structured tool
 * results the model can reason about, never thrown into the chat path.
 */
async function runOstraTool(
  attachment: FunctionToolAttachment,
  rawArguments: string,
  approval: { userApproved: boolean } = { userApproved: false },
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = rawArguments.trim().length > 0 ? JSON.parse(rawArguments) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("arguments must be a JSON object");
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return truncateToolResult(
      JSON.stringify({ ok: false, error: "invalid_arguments", message: "Tool arguments must be a JSON object." }),
    );
  }

  try {
    // Dynamic import: keeps the gateway free of tool-layer module cycles and
    // defers the cost until a tool call actually happens.
    const tools = await import("@/lib/tools");
    const result = await tools.executeTool(attachment.toolId, args, { userApproved: approval.userApproved });
    return truncateToolResult(JSON.stringify(result));
  } catch (error) {
    const tools = await import("@/lib/tools");
    if (error instanceof tools.ToolError) {
      return truncateToolResult(
        JSON.stringify({ ok: false, error: error.code, message: error.message }),
      );
    }
    return truncateToolResult(
      JSON.stringify({ ok: false, error: "tool_execution_failed", message: "Tool execution failed." }),
    );
  }
}

function truncateToolResult(serialized: string): string {
  return serialized.length > MAX_TOOL_RESULT_CHARS
    ? `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`
    : serialized;
}

function functionToolSystemPrompt(): string {
  return [
    "You have access to Ostra tools via function calling.",
    "When you need a tool, emit a tool call with valid JSON arguments; results arrive as tool messages.",
    "If a tool returns ok:false, tell the user the tool refused and why — never claim a tool succeeded when it did not run.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Mock adapter (delegates to existing MockModelProvider).
// Only ever reached through an EXPLICIT `provider: "mock"` selection — never
// as a fallback for a missing or invalid selection.
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
