/**
 * POST /api/chat — the only door between the browser and the model.
 *
 * Flow: validate → rate limit → agent runtime → ModelProvider → safe response.
 * Everything upstream of `getAgentRuntime()` happens server-side, so
 * MODEL_API_URL, MODEL_API_KEY and any other server env var stay hidden.
 */
import { NextResponse } from "next/server";
import { getAgentRuntime } from "@/lib/agent/runtime";
import { jsonError, logServerError, noStoreHeaders } from "@/lib/api/errors";
import { getClientKey, getRateLimiter } from "@/lib/api/rate-limit";
import { parseChatRequest } from "@/lib/api/validation";
import { describeModelTarget, ModelProviderError } from "@/lib/model";
import { getMaxMessageLength } from "@/lib/model/config";
import type { ChatApiSuccess } from "@/lib/system/info";

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
  const target = describeModelTarget();

  try {
    const result = await getAgentRuntime().respond({
      conversationId,
      history,
      message,
      signal: request.signal,
    });

    const payload: ChatApiSuccess = {
      message: result.content,
      conversationId,
      model: result.model,
      provider: result.provider,
      mode: result.provider === "http" ? "http" : "mock",
      latencyMs: result.latencyMs,
    };

    return NextResponse.json(payload, { headers: noStoreHeaders() });
  } catch (error) {
    return modelFailure(error, { requestId, mode: target.mode, maxLength: getMaxMessageLength() });
  }
}

export async function GET(): Promise<NextResponse> {
  return jsonError(405, "method_not_allowed", "Use POST to send a message to Ostra.");
}

/** Maps provider failures to safe client-facing errors. */
function modelFailure(
  error: unknown,
  context: { requestId: string; mode: string; maxLength: number },
): NextResponse {
  if (error instanceof ModelProviderError) {
    logServerError("chat", error);

    switch (error.code) {
      case "model_misconfigured":
        return jsonError(
          503,
          "model_not_configured",
          "The model endpoint is not configured on the server (MODEL_MODE / MODEL_API_URL).",
          context.requestId,
        );
      case "model_timeout":
        return jsonError(504, "model_timeout", "The model endpoint did not answer in time.", context.requestId);
      case "model_cancelled":
        return jsonError(499, "request_cancelled", "The request was cancelled.", context.requestId);
      case "model_empty_response":
        return jsonError(
          502,
          "model_empty_response",
          "The model endpoint returned an empty response.",
          context.requestId,
        );
      case "model_http_error":
        return jsonError(
          502,
          "model_unavailable",
          `The model endpoint responded with an error${typeof error.status === "number" ? ` (HTTP ${error.status})` : ""}.`,
          context.requestId,
        );
      default:
        return jsonError(502, "model_unavailable", "Ostra could not reach the model endpoint.", context.requestId);
    }
  }

  logServerError("chat", error);
  return jsonError(500, "internal_error", "Ostra hit an internal error while generating a reply.", context.requestId);
}

function createRequestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}
