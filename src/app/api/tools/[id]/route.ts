/**
 * GET /api/tools/[id] — one tool's full status.
 *
 * `?probe=1` performs a live Vercel Connect scoped-token probe (connection
 * verification only — the token is discarded and never returned).
 */
import { NextResponse } from "next/server";
import { jsonError, noStoreHeaders } from "@/lib/api/errors";
import { getToolConnectionStatus, resolveTool, ToolError } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const toolId = decodeURIComponent(id);
  const probe = new URL(request.url).searchParams.get("probe") === "1";

  try {
    if (probe) {
      const connection = await getToolConnectionStatus(toolId);
      return NextResponse.json(connection, { headers: noStoreHeaders() });
    }

    const status = resolveTool(toolId);
    return NextResponse.json(status, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ToolError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(500, "internal_error", "The tool status could not be resolved.");
  }
}
