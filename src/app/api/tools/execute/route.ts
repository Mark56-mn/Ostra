/**
 * POST /api/tools/execute — server-side tool execution.
 *
 * Body: { toolId, args?, provider?, model?, approved? }
 *
 * The full pipeline runs here: registry → config → compatibility →
 * permission → schema validation → adapter. Nothing executes client-side;
 * OpenRouter server tools return an attachment spec instead of executing.
 */
import { NextResponse } from "next/server";
import { jsonError, noStoreHeaders } from "@/lib/api/errors";
import { getClientKey, getRateLimiter } from "@/lib/api/rate-limit";
import { executeTool, ToolError } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  // `approved` is the explicit confirmation signal for approval-gated tools.
  // Stage 2 accepts it only in the validated request body; a real consent UX
  // (signed confirmation tokens) arrives later.
  const approved = record.approved === true;

  try {
    const result = await executeTool(record.toolId, record.args ?? {}, {
      providerId: typeof record.provider === "string" ? record.provider : undefined,
      modelId: typeof record.model === "string" ? record.model : undefined,
      userApproved: approved,
    });

    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.status === 403 ? 403 : error.status;
      return jsonError(status, error.code, error.message);
    }
    return jsonError(500, "internal_error", "Tool execution failed.");
  }
}
