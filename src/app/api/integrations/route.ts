/**
 * GET /api/integrations — Vercel Connect integration catalog with honest
 * status. `?probe=1` performs live scoped-token probes (see status.ts);
 * default responses are side-effect free and never claim connection.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { MISSING_FROM_CATALOG } from "@/lib/integrations";
import { getIntegrationStatuses } from "@/lib/integrations/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const probe = new URL(request.url).searchParams.get("probe") === "1";
  const integrations = await getIntegrationStatuses(probe);

  const payload = {
    integrations,
    counts: {
      total: integrations.length,
      tier1: integrations.filter((i) => i.tier === 1).length,
      connected: integrations.filter((i) => i.connected === true).length,
    },
    /** Requested connectors that the current Vercel catalog does not provide. */
    catalogGaps: MISSING_FROM_CATALOG,
    catalogSource: "https://vercel.com/connect/browse",
    catalogCheckedAt: "2026-09-21",
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
