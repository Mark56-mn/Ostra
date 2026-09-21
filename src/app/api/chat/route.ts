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
import { resolveProviderConfig } from "@/lib/providers/config";
import { ChatToolError, resolveChatTools } from "@/lib/tools/chat-tools";
import { getActiveProviderConfig, type ChatApiSuccess } from "@/lib/system/info";

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

  // Stage 2: optional per-request model selection, validated server-side.
  const body = parsedBody as Record<string, unknown>;
  const providerOverride = resolveProviderOverride(body.model);
  if ("error" in providerOverride && providerOverride.error) {
    const failure = providerOverride as { error: ModelSelectionError };
    return jsonError(failure.error.status, failure.error.code, failure.error.message, requestId);
  }
  const override = (providerOverride as { override?: { providerId: string; modelId: string } }).override;

  // Stage 2: optional tool attachments, validated against the registry and
  // the effective provider/model (override wins over env default).
  const config = resolveProviderConfig();
  const effective = override
    ? { providerId: override.providerId, modelId: override.modelId }
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

  const providerConfig = getActiveProviderConfig();

  try {
    const result = await getAgentRuntime().respond({
      conversationId,
      history,
      message,
      signal: request.signal,
      ...(override ? { providerOverride: override } : {}),
      ...(toolAttachment ? { tools: toolAttachment.tools, maxToolCalls: toolAttachment.maxToolCalls } : {}),
    });

    const payload: ChatApiSuccess = {
      message: result.content,
      conversationId,
      model: result.model,
      provider: result.provider,
      mode: result.provider === "mock" ? "mock" : "live",
      latencyMs: result.latencyMs,
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
