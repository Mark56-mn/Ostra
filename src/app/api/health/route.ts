/**
 * GET /api/health
 *
 * Reports liveness plus a secret-free description of the active provider.
 * API keys are never included — only whether providers are configured and keys present.
 *
 * Status states:
 * - ok: provider configured and key present (or mock mode)
 * - degraded: provider configured but key missing
 * - error: invalid provider configuration
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { resolveProviderConfig } from "@/lib/providers";
import { OSTRA_VERSION } from "@/lib/agent/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = resolveProviderConfig();

  // Determine status
  let status: "ok" | "degraded" | "error" = "ok";
  if (config.configError) {
    status = "error";
  } else if (config.mode === "provider" && config.provider && !config.provider.apiKey) {
    status = "degraded";
  }

  const provider = config.provider;
  const payload = {
    status,
    system: "ostra",
    version: OSTRA_VERSION,
    mode: config.mode,
    provider: provider?.id ?? "mock",
    model: provider?.model ?? "ostra-mock-1",
    endpointConfigured: config.mode === "provider" && Boolean(provider?.apiKey),
    keyPresent: Boolean(provider?.apiKey),
    adapter: provider?.adapter ?? "openai-compatible",
    configError: config.configError ?? undefined,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
