/**
 * POST /api/tools/validate — model ↔ tool compatibility + permission check.
 *
 * Body: { toolId, provider, model }
 * Returns a structured compatibility verdict. 409 with a safe code when
 * incompatible, disabled, or unconnected; never pretends a tool will work.
 */
import { NextResponse } from "next/server";
import { jsonError, noStoreHeaders } from "@/lib/api/errors";
import { getClientKey, getRateLimiter } from "@/lib/api/rate-limit";
import { evaluateToolForModel } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const rate = getRateLimiter().check(getClientKey(request));
  if (!rate.ok) {
    return jsonError(429, "rate_limited", "Too many requests. Give Ostra a moment.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "The request body is not valid JSON.");
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const result = evaluateToolForModel({
    toolId: record.toolId,
    provider: record.provider,
    model: record.model,
  });

  if (!result.ok) {
    return jsonError(result.status, result.code, result.message);
  }

  return NextResponse.json(result.result, { headers: noStoreHeaders() });
}
