/**
 * POST /api/tools/configure — enable/disable a tool and set approval policy.
 *
 * Body: { toolId, enabled?, approval?: "always" | "never" | null }
 * Validation happens against the registry; unknown tools are rejected.
 */
import { NextResponse } from "next/server";
import { jsonError, noStoreHeaders } from "@/lib/api/errors";
import { getToolDefinition } from "@/lib/tools/registry";
import { toolConfigStore } from "@/lib/tools/config";
import type { ToolPermission } from "@/lib/tools/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINANCIAL_OR_DESTRUCTIVE = new Set<ToolPermission>(["financial", "destructive"]);

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "The request body is not valid JSON.");
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const toolId = typeof record.toolId === "string" ? record.toolId : null;

  if (!toolId) {
    return jsonError(400, "invalid_format", "`toolId` is required.");
  }

  const tool = getToolDefinition(toolId);
  if (!tool) {
    return jsonError(404, "unknown_tool", "That tool is not in Ostra's registry.");
  }

  let touched = false;
  let snapshot = toolConfigStore.getSnapshot();

  if (typeof record.enabled === "boolean") {
    // Financial/destructive tools can never be fully auto-approved; approval
    // "always" is refused for them regardless of enablement.
    if (record.enabled && FINANCIAL_OR_DESTRUCTIVE.has(tool.permission)) {
      const override = snapshot.overrides[tool.id];
      if (override?.approval === "always") {
        return jsonError(409, "invalid_policy", "Financial and destructive tools cannot be set to skip confirmation.");
      }
    }
    snapshot = toolConfigStore.setEnabled(toolId, record.enabled);
    touched = true;
  }

  if (record.approval !== undefined) {
    if (record.approval !== null && record.approval !== "always" && record.approval !== "never") {
      return jsonError(400, "invalid_format", "`approval` must be \"always\", \"never\", or null.");
    }
    if (record.approval === "never" && FINANCIAL_OR_DESTRUCTIVE.has(tool.permission)) {
      return jsonError(409, "invalid_policy", "Financial and destructive tools always require explicit confirmation.");
    }
    snapshot = toolConfigStore.setApproval(toolId, record.approval);
    touched = true;
  }

  if (!touched) {
    return jsonError(400, "invalid_format", "Nothing to configure: pass `enabled` and/or `approval`.");
  }

  return NextResponse.json({ toolId, snapshot }, { headers: noStoreHeaders() });
}

