/**
 * GET /api/models — the server-controlled model catalog.
 *
 * Returns the allowlisted providers/models the Model Control Center may
 * select from, plus per-provider key *presence* (never key values) and the
 * server's current default selection. Everything is resolved server-side.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { getAllModelCapabilities } from "@/lib/providers/capabilities";
import { getModelCatalog } from "@/lib/providers";
import { resolveProviderConfig } from "@/lib/providers/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = resolveProviderConfig();

  const payload = {
    providers: getModelCatalog(),
    // Verified capability entries — capability claims always carry their
    // verification source; absent entries mean "unknown", never guessed.
    capabilities: getAllModelCapabilities(),
    active: {
      mode: config.configError ? "error" : config.mode,
      provider: config.provider?.id ?? "mock",
      model: config.provider?.model ?? "ostra-mock-1",
      keyPresent: Boolean(config.provider?.apiKey),
      configError: config.configError ?? null,
    },
    // Which provider+model the server uses when a task does not select one.
    defaultSelection:
      config.mode === "provider" && config.provider
        ? { provider: config.provider.id, model: config.provider.model }
        : { provider: "mock", model: "ostra-mock-1" },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
