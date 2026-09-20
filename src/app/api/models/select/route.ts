/**
 * POST /api/models/select — deliberate model selection (Stage 2).
 *
 * The browser sends an allowlisted { provider, model, role? } selection.
 * The server validates it against the catalog and the environment: unknown
 * providers, non-allowlisted models and providers without a configured key
 * are all rejected. No key ever travels to or from the browser.
 *
 * - POST { provider, model, role? }        → sets the workspace default
 * - POST { name?, models: [...] }          → saves a task model configuration
 * - GET                                    → inspects the current selection
 */
import { NextResponse } from "next/server";
import { logServerError, noStoreHeaders } from "@/lib/api/errors";
import { getClientKey, getRateLimiter } from "@/lib/api/rate-limit";
import { ModelSelectionError, validateModelSelection, validateSelectionList } from "@/lib/model-selection";
import { modelSelectionStore } from "@/lib/model-selection/store";
import { resolveProviderConfig } from "@/lib/providers/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const rate = getRateLimiter().check(`model-select:${getClientKey(request)}`);
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many selection changes. Give Ostra a moment." } },
      { status: 429, headers: { ...noStoreHeaders(), "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Request body must be a JSON object." } },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const record = body as Record<string, unknown>;

  try {
    // Shape 1: single selection — sets the workspace default.
    if (record.models === undefined) {
      const selection = validateModelSelection(record);
      const saved = modelSelectionStore.setDefault({
        provider: selection.provider,
        model: selection.model,
        role: selection.role,
      });
      return NextResponse.json({ selected: saved, timestamp: new Date().toISOString() }, { headers: noStoreHeaders() });
    }

    // Shape 2: { models: [...] } — a deliberate task configuration.
    const selections = validateSelectionList(record.models);
    const snapshot = modelSelectionStore.setTaskConfig({
      name: typeof record.name === "string" ? record.name.trim().slice(0, 200) || "Model configuration" : "Model configuration",
      models: selections.map((sel) => ({ provider: sel.provider, model: sel.model, role: sel.role })),
    });

    return NextResponse.json(
      { taskConfig: snapshot, timestamp: new Date().toISOString() },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof ModelSelectionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    logServerError("models/select", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "The selection could not be saved." } },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  const config = resolveProviderConfig();
  const workspace = modelSelectionStore.getState();
  return NextResponse.json(
    {
      default: workspace.default,
      taskConfig: workspace.taskConfig,
      serverDefault:
        config.mode === "provider" && config.provider
          ? { provider: config.provider.id, model: config.provider.model }
          : { provider: "mock", model: "ostra-mock-1" },
      timestamp: new Date().toISOString(),
    },
    { headers: noStoreHeaders() },
  );
}
