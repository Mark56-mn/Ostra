/**
 * GET /api/integrations/[id] — one integration's status.
 * `?probe=1` verifies the live connection through a scoped-token probe.
 */
import { NextResponse } from "next/server";
import { jsonError, noStoreHeaders } from "@/lib/api/errors";
import { getIntegrationStatus } from "@/lib/integrations/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const probe = new URL(request.url).searchParams.get("probe") === "1";

  const integration = await getIntegrationStatus(decodeURIComponent(id), probe);
  if (!integration) {
    return jsonError(404, "unknown_integration", "That integration is not in Ostra's catalog.");
  }

  return NextResponse.json(integration, { headers: noStoreHeaders() });
}
