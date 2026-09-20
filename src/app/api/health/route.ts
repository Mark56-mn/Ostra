/**
 * GET /api/health
 *
 * Reports liveness plus a secret-free description of the active provider.
 * API keys are never included — only whether providers are configured and
 * keys are present. Status states:
 * - ok: provider configured and key present (or mock mode)
 * - degraded: provider configured but key missing
 * - error: invalid provider configuration
 *
 * The payload shape lives in @/lib/system/health so it can be tested directly.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { buildHealthPayload } from "@/lib/system/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(buildHealthPayload(), { headers: noStoreHeaders() });
}
