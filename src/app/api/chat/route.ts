/**
 * POST /api/chat — the only door between the browser and the model.
 *
 * Flow: validate → rate limit → agent runtime → provider gateway → safe response.
 * Everything upstream of `getAgentRuntime()` happens server-side, so
 * API keys and any other server env var stay hidden.
 *
 * Stage 2: an optional `model` selection ({ provider, model }) may be sent.
 * It is validated against the server-controlled allowlist before use —
 * non-allowlisted models and providers without a configured key are rejected.
 */
import { NextResponse } from "next/server";
import { getAgentRuntime } from "@/lib/agent/runtime";
import { jsonError, logServerError, noStoreHeaders } from "@/lib/api/errors";
import { getClientKey, getRateLimiter } from "@/lib/api/rate-limit";
import { parseChatRequest } from "@/lib/api/validation";
import { ModelSelectionError, validateModelSelection } from "@/lib/model-selection";
import { modelSelectionStore } from "@/lib/model-selection/store";
import { resolveProviderConfig } from "@/lib/providers/config";
import { ChatToolError, resolveChatTools } from "@/lib/tools/chat-tools";
import { resolveAutoTools } from "@/lib/tools/chat-attach";
import { getToolDefinition } from "@/lib/tools/registry";
import { toolConfigStore } from "@/lib/tools/config";
import { toFunctionAttachment } from "@/lib/tools/chat-attach";
import { getActiveProviderConfig, type ChatApiSuccess } from "@/lib/system/info";
import type { ModelMessage } from "@/lib/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hard cap on the raw request body before we even parse it. */
const MAX_BODY_CHARS = 256_000;

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = createRequestId();

  const rate = getRateLimiter().check(getClientKey(request));
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many messages. Give Ostra a moment." }, requestId },
      { status: 429, headers: { ...noStoreHeaders(), "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonError(415, "unsupported_media_type", "Send the request as application/json.", requestId);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError(400, "unreadable_body", "The request body could not be read.", requestId);
  }

  if (rawBody.length > MAX_BODY_CHARS) {
    return jsonError(413, "payload_too_large", "The request body is too large.", requestId);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "invalid_json", "The request body is not valid JSON.", requestId);
  }

  const validation = parseChatRequest(parsedBody);
  if (!validation.ok) {
    return jsonError(400, validation.code, validation.message, requestId);
  }

  const { message, conversationId, history } = validation.value;

  // V1: explicit per-request approval confirmations for approval-gated tools
  // (e.g. mem0.save_memory). Server-validated against the registry; the model
  // can never self-approve — this list is the only approval signal.
  const approvedToolIds = parseApprovedToolIds((parsedBody as Record<string, unknown>).approvedTools);

  // Stage 2: optional per-request model selection, validated server-side.
  const body = parsedBody as Record<string, unknown>;
  const providerOverride = resolveProviderOverride(body.model);
  if ("error" in providerOverride && providerOverride.error) {
    const failure = providerOverride as { error: ModelSelectionError };
    return jsonError(failure.error.status, failure.error.code, failure.error.message, requestId);
  }
  const override = (providerOverride as { override?: { providerId: string; modelId: string } }).override;

  // A deliberate server-side workspace default (set via "Use as default" in
  // the Model Control Center) applies when the request carries no per-request
  // selection. This is the missing link that made provider switches appear to
  // "snap back" to OpenRouter: the header preference and the server default
  // were stored in separate places and /api/chat never consulted the latter.
  const workspaceDefault = modelSelectionStore.getState().default;
  const override2: { providerId: string; modelId: string } | null =
    override ?? (workspaceDefault ? { providerId: workspaceDefault.provider, modelId: workspaceDefault.model } : null);

  // Stage 2: optional tool attachments, validated against the registry and
  // the effective provider/model (selection wins over env default).
  const config = resolveProviderConfig();
  const hasDeliberateSelection = Boolean(override ?? workspaceDefault);
  const effective = hasDeliberateSelection && override2
    ? { providerId: override2.providerId, modelId: override2.modelId }
    : { providerId: config.provider?.id ?? "mock", modelId: config.provider?.model ?? "ostra-mock-1" };
  let toolAttachment: ReturnType<typeof resolveChatTools>;
  try {
    toolAttachment = resolveChatTools(body.tools, effective);
  } catch (error) {
    if (error instanceof ChatToolError) {
      return jsonError(error.status, error.code, error.message, requestId);
    }
    throw error;
  }

  // Stage 3: tools the model may call. Native tools (datetime, web fetch) are
  // auto-attached for every tool-calling model; OpenRouter models additionally
  // get the server-side web search/fetch. Client-requested server tools merge
  // on top. Tool-calling models without verified capabilities get nothing —
  // never a guess.
  const autoTools = await resolveAutoTools(effective.providerId, effective.modelId);
  const mergedServerTools = [...autoTools.serverTools];
  if (toolAttachment) {
    for (const requested of toolAttachment.tools) {
      if (!mergedServerTools.some((t) => t.type === requested.type)) mergedServerTools.push(requested);
  }
  }
  // An explicitly approved write tool joins the function tools for this turn
  // (still permission-checked in the pipeline, with this one approval signal).
  const approvedAttachments = approvedToolIds
    .map((toolId) => ({ toolId, tool: getToolDefinition(toolId) }))
    .filter(
      (entry): entry is { toolId: string; tool: NonNullable<ReturnType<typeof getToolDefinition>> } =>
        entry.tool !== null &&
        entry.tool.executionType === "vercel-connect" &&
        toolConfigStore.isEnabled(entry.tool),
    )
    .map((entry) => entry.tool)
    .filter((tool) => !autoTools.functionTools.some((existing) => existing.toolId === tool.id))
    .map((tool) => toFunctionAttachment(tool));
  const allFunctionTools = [...autoTools.functionTools, ...approvedAttachments];
  const hasFunctionTools = allFunctionTools.length > 0;

  const providerConfig = getActiveProviderConfig();

  // Memory recall (adapter task §16A): when persistent memory is execution-
  // ready (Connect grant or MEM0_API_KEY) and the message looks memory-
  // dependent, relevant memories are retrieved server-side and injected as
  // context before the model answers. Failures never block the chat.
  const memoryContext = await buildMemoryContext(message);

  try {
    const result = await getAgentRuntime().respond({
      conversationId,
      history,
      message,
      signal: request.signal,
      // The deliberate selection (per-request or workspace default) overrides
      // the env-configured provider for this turn.
      ...(override2 ? { providerOverride: override2 } : {}),
      ...(mergedServerTools.length > 0 ? { tools: mergedServerTools, maxToolCalls: toolAttachment?.maxToolCalls } : {}),
      ...(hasFunctionTools ? { functionTools: allFunctionTools } : {}),
      ...(approvedToolIds.length > 0 ? { approvedToolIds } : {}),
      ...(memoryContext.length > 0 ? { contextMessages: memoryContext } : {}),
    });

    const payload: ChatApiSuccess = {
      message: result.content,
      conversationId,
      model: result.model,
      provider: result.provider,
      mode: result.provider === "mock" ? "mock" : "live",
      latencyMs: result.latencyMs,
      // Verification metadata: what the client asked for, what the server
      // resolved (null = env default), so any client can prove which provider
      // answered and a selection can never silently snap back.
      requested: hasDeliberateSelection && override2 ? { provider: override2.providerId, model: override2.modelId } : null,
      selectionSource: override ? ("request" as const) : hasDeliberateSelection && override2 ? ("workspace" as const) : ("env" as const),
      // Tool transparency: which Ostra tools ran, how many provider-side server
      // steps happened, and citation URLs from web search/fetch.
      ...(result.toolUsage
        ? {
            toolsUsed: result.toolUsage.clientToolCalls,
            serverToolSteps: result.toolUsage.serverToolSteps,
            ...(result.toolUsage.sources.length > 0 ? { sources: result.toolUsage.sources } : {}),
          }
        : { toolsUsed: [] }),
      // Memory transparency: whether recall ran for this turn.
      memoryRecalled: memoryContext.length > 0,
    };

    return NextResponse.json(payload, { headers: noStoreHeaders() });
  } catch (error) {
    return modelFailure(error, {
      requestId,
      provider: override?.providerId ?? providerConfig.id,
      model: override?.modelId ?? providerConfig.modelId,
    });
  }
}

export async function GET(): Promise<NextResponse> {
  return jsonError(405, "method_not_allowed", "Use POST to send a message to Ostra.");
}

/**
 * Memory-recall trigger: only messages that plausibly need prior knowledge
 * incur the recall round trip. Deliberately conservative — a miss costs
 * nothing and a false negative falls back to the mem0.search_memory tool.
 */
const MEMORY_TRIGGER =
  /\b(remember|recall|memory|remind|my name|my project|my preferences|i told you|earlier|last time|previously|favorite|prefer)\b/i;

const MEMORY_CONTEXT_LIMITS = {
  maxResults: 5,
  maxChars: 1_200,
  timeoutMs: 8_000,
} as const;

/**
 * Retrieve relevant persistent memories for a message through the Mem0
 * adapter (Connect MCP or env credential — whichever is execution-ready).
 * Structured failures return an empty list; this path can never block or
 * fail a chat, and never exposes credential material (results are model-
 * visible memory text only).
 */
async function buildMemoryContext(message: string): Promise<ModelMessage[]> {
  if (!MEMORY_TRIGGER.test(message)) return [];
  try {
    const { mem0SearchMemory } = await import("@/lib/integrations/connect-runtime");
    const { getExecutionReadiness } = await import("@/lib/integrations/connect-runtime");
    const readiness = await getExecutionReadiness("mem0");
    if (!readiness.executionReady) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEMORY_CONTEXT_LIMITS.timeoutMs);
    try {
      const result = await Promise.race([
        mem0SearchMemory(message.slice(0, 400)),
        new Promise<null>((resolve) => {
          const abort = (): void => resolve(null);
          controller.signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
      if (!result || !result.ok) return [];
      const lines = result.results
        .slice(0, MEMORY_CONTEXT_LIMITS.maxResults)
        .map((entry) => `- ${entry.text.slice(0, 300)}`)
        .join("\n")
        .slice(0, MEMORY_CONTEXT_LIMITS.maxChars);
      if (lines.length === 0) return [];
      return [
        {
          role: "system" as const,
          content: `Relevant persistent memories about the user (retrieved via Ostra's memory layer; use if helpful):\n${lines}`,
        },
      ];
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

/**
 * Parse the optional `approvedTools` confirmation list: registry-known ids
 * only, deduplicated, capped. The model never supplies this — it comes from
 * the validated request body (the UI's explicit confirmation control).
 */
function parseApprovedToolIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, 5)) {
    if (typeof entry !== "string") continue;
    const tool = getToolDefinition(entry);
    if (tool && tool.requiresApproval) seen.add(tool.id);
  }
  return [...seen];
}

/**
 * Resolve the optional `model` field from the request body into a validated
 * override, or null when absent. Throws-safe: returns a ModelSelectionError
 * when the selection fails validation.
 */
function resolveProviderOverride(
  raw: unknown,
): { override: null } | { override: { providerId: string; modelId: string }; error?: never } | { error: ModelSelectionError } {
  if (raw === undefined || raw === null) return { override: null };
  try {
    const selection = validateModelSelection(raw);
    if (selection.provider === "mock") return { override: null };
    return { override: { providerId: selection.provider, modelId: selection.model } };
  } catch (error) {
    if (error instanceof ModelSelectionError) return { error };
    throw error;
  }
}

/** Maps provider failures to safe client-facing errors. */
function modelFailure(
  error: unknown,
  context: { requestId: string; provider: string; model: string },
): NextResponse {
  logServerError("chat", error);

  if (error instanceof Error) {
    const msg = error.message;

    if (msg.includes("not configured") || msg.includes("missing")) {
      return jsonError(
        503,
        "model_not_configured",
        "The model provider is not configured on the server. Check Ostra environment variables.",
        context.requestId,
      );
    }

    if (msg.includes("timeout") || msg.includes("abort")) {
      return jsonError(504, "model_timeout", "The model endpoint did not answer in time.", context.requestId);
    }

    if (msg.includes("cancelled")) {
      return jsonError(499, "request_cancelled", "The request was cancelled.", context.requestId);
    }

    if (msg.includes("empty") || msg.includes("No content")) {
      return jsonError(
        502,
        "model_empty_response",
        "The model endpoint returned an empty response.",
        context.requestId,
      );
    }

    if (msg.includes("HTTP") || msg.includes("status")) {
      return jsonError(
        502,
        "model_unavailable",
        `The model endpoint responded with an error.`,
        context.requestId,
      );
    }
  }

  return jsonError(500, "internal_error", "Ostra hit an internal error while generating a reply.", context.requestId);
}

function createRequestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}
