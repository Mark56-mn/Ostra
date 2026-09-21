/**
 * Tool executor (Stage 2) — adapters, one per execution type.
 *
 * Flow: permission decision → argument validation → adapter.execute() →
 * sanitized result. Provider-specific logic lives ONLY here.
 *
 * - openrouter:      not executed here — returned as request attachment specs
 *                    for the model gateway (see buildOpenRouterToolSpecs).
 * - native:          executed in-process (ostra:noop).
 * - vercel-connect:  executes through @vercel/connect scoped runtime tokens.
 * - external:        registered seam; execution arrives with Stage 3.
 */
import type { ToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Vercel Connect adapter
// ---------------------------------------------------------------------------

/**
 * Connector identifier for a tool, per the current Vercel Connect catalog
 * (vercel.com/connect/browse, fetched 2026-09-21). `null` means "no
 * equivalent connector exists in the current catalog" — the honest answer
 * that keeps the integration layer from claiming availability it lacks.
 */
const VERCEL_CONNECT_CONNECTOR_IDS: Record<string, string | null> = {
  "connect:github": "github",
  "connect:vercel": "vercel",
  "connect:supabase": "supabase",
  "connect:cloudflare": "cloudflare",
  "connect:google": "google",
  "connect:notion": "notion",
  "connect:slack": "slack",
  "connect:agentmail": "agentmail",
  "connect:mem0": "mem0",
  "connect:firecrawl": "firecrawl",
  "connect:telegram-bot": "telegram-bot",
  "connect:zapier": "zapier",
  "connect:stripe": "stripe",
  "connect:paypal": "paypal",
  "connect:shopify": "shopify",
  "connect:linkedin": "linkedin",
  "connect:x": "x",
  "connect:reddit": "reddit",
  "connect:figma": "figma",
  "connect:sentry": "sentry",
  "connect:linear": "linear",
  "connect:jira": "jira",
  "connect:airtable": "airtable",
  "connect:n8n": "n8n",
  "connect:make": "make",
  "connect:replicate": "replicate",
  "connect:hugging-face": "hugging-face",
  "connect:elevenlabs": "elevenlabs",
  "connect:deepgram": "deepgram",
  "connect:kernel": "kernel",
  "connect:perplexity": "perplexity",
  "connect:gitlab": "gitlab",
  "connect:microsoft-teams": "microsoft-teams",
  "connect:resend": "resend",
  "connect:sendgrid": "sendgrid",
  "connect:mailgun": "mailgun",
  "connect:neon": "neon",
  "connect:render": "render",
  "connect:railway": "railway",
  "connect:openai": "openai",
  "connect:anthropic": "anthropic",
  "connect:google-gemini": "google-gemini",
  "connect:deepseek": "deepseek",
  "connect:cohere": "cohere",
  "connect:postman": "postman",
  "connect:dropbox": "dropbox",
  "connect:box": "box",
  "connect:coda": "coda",
  "connect:readwise": "readwise",
  "connect:hubspot": "hubspot",
  "connect:salesforce": "salesforce",
  "connect:attio": "attio",
  "connect:intercom": "intercom",
  "connect:asana": "asana",
  "connect:clickup": "clickup",
  "connect:monday.com": "monday.com",
  "connect:todoist": "todoist",
  "connect:zoom": "zoom",
};

export interface ConnectorLookupResult {
  /** Connector uid in the Vercel catalog, or null when none exists. */
  connectorUid: string | null;
  /** True when Ostra has not mapped this tool to the catalog yet. */
  unmapped: boolean;
}

export function lookupConnector(toolId: string): ConnectorLookupResult {
  const uid = VERCEL_CONNECT_CONNECTOR_IDS[toolId];
  return { connectorUid: uid ?? null, unmapped: uid === undefined };
}

export interface ConnectTokenRequestResult {
  ok: boolean;
  code:
    | "connected"
    | "not_connected"
    | "no_connector"
    | "unmapped"
    | "oidc_missing"
    | "adapter_error";
  /** Human-readable status; never contains token material. */
  message: string;
}

/**
 * Probe (and optionally execute through) a Vercel Connect connector.
 *
 * Stage 2 semantics: this resolves a *scoped runtime token* via
 * @vercel/connect to determine live connection status, then discards it —
 * it never returns credentials to callers and never places them in model
 * context. Actual per-connector operation execution lands in Stage 3 with
 * the task queue.
 */
export async function probeConnector(
  tool: ToolDefinition,
  options: { connectorUid: string },
): Promise<ConnectTokenRequestResult> {
  if (typeof process === "undefined" || !process.env?.VERCEL_OIDC_TOKEN) {
    return {
      ok: false,
      code: "oidc_missing",
      message:
        "No Vercel OIDC token in this environment — connection status cannot be verified here. Status shown reflects Vercel-side state once deployed.",
    };
  }

  try {
    // Dynamic import: the SDK reads VERCEL_OIDC_TOKEN at call time and this
    // module must also load in non-Vercel environments (tests, preview).
    const { getToken } = await import("@vercel/connect");
    await getToken(options.connectorUid, { subject: { type: "app" }, scopes: ["*"] });
    return { ok: true, code: "connected", message: "Connector produced a scoped runtime token; connection is live." };
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);
    if (name === "ConnectorNotFoundError" || name === "UserAuthorizationRequiredError" || name === "NoValidTokenError" || name === "ConnectorInstallationRequiredError") {
      return { ok: false, code: "not_connected", message: "Connector exists in Vercel but no usable grant is available." };
    }
    return { ok: false, code: "adapter_error", message: "Vercel Connect adapter could not verify the connection." };
  }
}

// ---------------------------------------------------------------------------
// Native adapter
// ---------------------------------------------------------------------------

export interface NativeExecutionResult {
  ok: boolean;
  output: string;
  code?: "executed" | "unsupported";
}

/** In-process execution for native tools. Stage 2 ships exactly one: noop. */
export async function executeNativeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<NativeExecutionResult> {
  if (tool.id === "ostra:noop") {
    return { ok: true, output: `echo: ${String(args.echo ?? "")}`, code: "executed" };
  }
  return { ok: false, output: "Native execution is not implemented for this tool.", code: "unsupported" };
}

// ---------------------------------------------------------------------------
// OpenRouter server tools — request attachment specs
// ---------------------------------------------------------------------------

export interface OpenRouterToolSpec {
  type: string;
  parameters?: Record<string, unknown>;
}

/**
 * Build the `tools` array entries for an OpenAI-compatible request body.
 * OpenRouter executes server tools itself; Ostra only declares them and
 * enforces the step budget.
 */
export function buildOpenRouterToolSpecs(tools: ToolDefinition[], maxToolCalls = 5): { tools: OpenRouterToolSpec[]; maxToolCalls: number } {
  return {
    tools: tools.map((tool) => ({
      type: tool.id,
      parameters: sanitizeParameters(tool.inputSchema),
    })),
    maxToolCalls,
  };
}

function sanitizeParameters(schema: unknown): Record<string, unknown> | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (s.properties && typeof s.properties === "object") out.properties = s.properties;
  if (Array.isArray(s.required)) out.required = s.required;
  return Object.keys(out).length > 0 ? out : undefined;
}
