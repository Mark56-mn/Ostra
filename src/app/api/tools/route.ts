/**
 * GET /api/tools — the server-controlled tool registry.
 *
 * Returns every allowlisted tool with its current enablement and approval
 * state resolved through the config store. No secrets, no client trust.
 */
import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/api/errors";
import { getAllToolStatuses, getIntegrationOperationEnvCredentials } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const tools = getAllToolStatuses();
  // Env-credential NAMES (never values) backing each concrete integration
  // operation, so the UI can distinguish "needs connection" from "env-ready".
  const envCredentials = await getIntegrationOperationEnvCredentials();

  const payload = {
    tools,
    envCredentials,
    counts: {
      total: tools.length,
      enabled: tools.filter((t) => t.enabled).length,
      byExecutionType: tools.reduce<Record<string, number>>((acc, tool) => {
        acc[tool.executionType] = (acc[tool.executionType] ?? 0) + 1;
        return acc;
      }, {}),
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(payload, { headers: noStoreHeaders() });
}
