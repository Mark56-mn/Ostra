/**
 * GET /api/health
 *
 * Reports liveness plus a secret-free description of the active provider.
 * API keys are never included — only whether providers are configured.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { getActiveProviderConfig, type SystemInfo } from "@/lib/system/info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<SystemInfo>> {
  const providerConfig = getActiveProviderConfig();

  const payload: SystemInfo = {
    status: "ok",
    system: "ostra",
    version: "0.1.0",
    mode: providerConfig.isConfigured ? "live" : "unconfigured",
    provider: providerConfig.id,
    model: providerConfig.modelId,
    endpointConfigured: providerConfig.isConfigured,
    apiFormat: providerConfig.format,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
