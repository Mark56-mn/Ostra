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
import { modelSelectionStore } from "@/lib/model-selection/store";

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
    // Legacy field name kept so existing clients keep working: what /api/chat
    // uses when a task does not select one — the workspace default when one
    // exists, mock mode otherwise. There is no hardcoded env-side default.
    defaultSelection:
      config.mode === "provider" && config.provider
        ? { provider: config.provider.id, model: config.provider.model }
        : modelSelectionStore.getState().default ?? { provider: "mock", model: "ostra-mock-1" },
    // The deliberate workspace default ("Use as default" in this control
    // center). /api/chat applies it whenever a request carries no explicit
    // selection, so a provider switch here sticks everywhere.
    workspaceDefault: modelSelectionStore.getState().default,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
