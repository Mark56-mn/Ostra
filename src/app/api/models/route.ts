/**
 * GET /api/models — the server-controlled model catalog.
 *
 * Returns the allowlisted providers/models the Model Control Center may
 * select from, plus per-provider key *presence* (never key values) and the
 * workspace default selection. Everything is resolved server-side.
 *
 * There is no globally active provider: `active` reports model-link
 * readiness, and `workspaceDefault` is the only fallback /api/chat applies.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { getAllModelCapabilities } from "@/lib/providers/capabilities";
import { getModelCatalog } from "@/lib/providers";
import { getProviderStatusSummary } from "@/lib/providers/config-status";
import { modelSelectionStore } from "@/lib/model-selection/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const summary = getProviderStatusSummary();
  const workspaceDefault = modelSelectionStore.getState().default;

  const payload = {
    providers: getModelCatalog(),
    // Verified capability entries — capability claims always carry their
    // verification source; absent entries mean "unknown", never guessed.
    capabilities: getAllModelCapabilities(),
    active: {
      mode: summary.mode,
      // No global active provider: the id is always "none" until a model is
      // selected per request or as the workspace default.
      provider: "none",
      model: "",
      keyPresent: summary.keyPresent,
      customEndpoint: summary.customEndpoint,
      selectableProviders: summary.providers.filter((provider) => provider.active).map((provider) => provider.id),
    },
    // What /api/chat uses when a request does not select a model: the
    // deliberate workspace default. Null when none is set — in which case
    // /api/chat returns 409 model_not_selected instead of guessing.
    defaultSelection: workspaceDefault ?? null,
    // The deliberate workspace default ("Use as default" in this control
    // center). /api/chat applies it whenever a request carries no explicit
    // selection, so a provider switch here sticks everywhere.
    workspaceDefault,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
