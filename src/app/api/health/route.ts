/**
 * GET /api/health
 *
 * Reports liveness plus a secret-free description of the model link. The URL
 * and key of the model endpoint are never included — only whether one is
 * configured.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { describeModelTarget, getModelConfig } from "@/lib/model";
import { OSTRA_VERSION } from "@/lib/agent/persona";
import type { SystemInfo } from "@/lib/system/info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<SystemInfo>> {
  const target = describeModelTarget();

  const payload: SystemInfo = {
    status: "ok",
    system: "ostra",
    version: OSTRA_VERSION,
    mode: target.mode,
    provider: target.provider,
    model: target.model,
    endpointConfigured: target.endpointConfigured,
    apiFormat: target.apiFormat,
    timestamp: new Date().toISOString(),
  };

  // Touch the config so a misconfigured combination is obvious in logs.
  if (getModelConfig().mode === "http" && !target.endpointConfigured) {
    console.warn("[ostra:health] MODEL_MODE=http but MODEL_API_URL is empty");
  }

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
