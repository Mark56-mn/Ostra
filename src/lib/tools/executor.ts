/**
 * Tool executor (Stage 2/3) — adapters, one per execution type.
 *
 * Flow: permission decision → argument validation → adapter.execute() →
 * sanitized result. Provider-specific logic lives ONLY here.
 *
 * - openrouter:      not executed here — returned as request attachment specs
 *                    for the model gateway (see buildOpenRouterToolSpecs).
 * - native:          executed in-process (ostra:noop, ostra:datetime,
 *                    ostra:web_fetch).
 * - vercel-connect:  executes through @vercel/connect scoped runtime tokens.
 * - external:        registered seam; execution arrives in a later stage.
 */
import { isAbortError } from "@/lib/utils";
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
 * Probe a Vercel Connect connector's live status (status endpoints). The
 * scoped runtime token resolved via @vercel/connect is discarded immediately
 * — it never returns credentials to callers and never places them in model
 * context. Operation execution lives in executeConnectOperation().
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
// Vercel Connect operation execution (V1)
// ---------------------------------------------------------------------------

/**
 * Execute one concrete Vercel Connect operation through the official
 * runtime. Input is already schema-validated; the runtime resolves scoped
 * credentials itself and returns structured, secret-free results.
 */
export async function executeConnectOperation(
  toolId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string; code: string }> {
  const runtime = await import("@/lib/integrations/connect-runtime");

  if (toolId === "github.list_repositories") {
    const result = await runtime.githubListRepositories({
      per_page: typeof args.per_page === "number" ? args.per_page : undefined,
      page: typeof args.page === "number" ? args.page : undefined,
      sort: typeof args.sort === "string" ? args.sort : undefined,
    });
    if (!result.ok) {
      return { ok: false, code: result.code, output: JSON.stringify({ ok: false, error: result.code, message: result.message }) };
    }
    const payload = {
      ok: true,
      account: result.login,
      total_returned: result.repos.length,
      truncated: result.truncated,
      repositories: result.repos,
    };
    return { ok: true, code: "executed", output: JSON.stringify(payload).slice(0, CONNECT_MAX_OUTPUT_CHARS) };
  }

  if (toolId === "mem0.search_memory") {
    const result = await runtime.mem0SearchMemory(String(args.query));
    return result.ok
      ? { ok: true, code: "executed", output: JSON.stringify({ ok: true, query: args.query, results: result.results }).slice(0, CONNECT_MAX_OUTPUT_CHARS) }
      : { ok: false, code: result.code, output: JSON.stringify({ ok: false, error: result.code, message: result.message }) };
  }

  if (toolId === "mem0.save_memory") {
    const result = await runtime.mem0SaveMemory(String(args.text));
    return result.ok
      ? { ok: true, code: "executed", output: JSON.stringify({ ok: true, saved: true, message: result.message }) }
      : { ok: false, code: result.code, output: JSON.stringify({ ok: false, error: result.code, message: result.message }) };
  }

  return { ok: false, code: "unsupported_execution", output: JSON.stringify({ ok: false, error: "unsupported_execution", message: "This integration operation is not implemented yet." }) };
}

/** Hard cap for serialized integration results entering model context. */
const CONNECT_MAX_OUTPUT_CHARS = 20_000;

// ---------------------------------------------------------------------------
// Native adapter
// ---------------------------------------------------------------------------

export interface NativeExecutionResult {
  ok: boolean;
  output: string;
  code?: "executed" | "unsupported";
}

/** In-process execution for native tools: noop, datetime, web_fetch, firecrawl.search. */
export async function executeNativeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<NativeExecutionResult> {
  if (tool.id === "ostra:noop") {
    return { ok: true, output: `echo: ${String(args.echo ?? "")}`, code: "executed" };
  }
  if (tool.id === "ostra:datetime") {
    return { ok: true, output: JSON.stringify(formatDateTime()), code: "executed" };
  }
  if (tool.id === "ostra:web_fetch") {
    return fetchPublicPage(args);
  }
  if (tool.id === "firecrawl.search") {
    return firecrawlWebSearch(args);
  }
  return { ok: false, output: "Native execution is not implemented for this tool.", code: "unsupported" };
}

export interface DatetimeOutput {
  iso_utc: string;
  epoch_ms: number;
  weekday_utc: string;
  date_local: string;
  time_local: string;
  timezone: string;
}

/** Reliable, testable current-time snapshot for the model. */
export function formatDateTime(now: Date = new Date()): DatetimeOutput {
  return {
    iso_utc: now.toISOString(),
    epoch_ms: now.getTime(),
    weekday_utc: now.toUTCString().slice(0, 3),
    date_local: new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now),
    time_local: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  };
}

// ---------------------------------------------------------------------------
// ostra:web_fetch — safe public-page fetch (native adapter)
// ---------------------------------------------------------------------------

/** Hard limits so a fetch can never become a server-side network hazard. */
export const WEB_FETCH_LIMITS = {
  maxBytes: 1_500_000,
  timeoutMs: 15_000,
  maxRedirects: 4,
  maxOutputChars: 8_000,
} as const;

/** URL scheme must be http(s) and the host must not be a loopback/private target. */
export function validateFetchUrl(raw: unknown): { ok: true; url: URL } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "A `url` string is required." };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "The URL could not be parsed." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https URLs are allowed." };
  }
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254";
  if (isPrivate) {
    return { ok: false, reason: "Private, loopback and link-local hosts are not fetchable." };
  }
  if (url.port !== "" && !/^(80|443|8080|8443)$/.test(url.port)) {
    return { ok: false, reason: "Only ports 80, 443, 8080 and 8443 are allowed." };
  }
  return { ok: true, url };
}

/**
 * Fetch a public page and return model-usable text. Never throws: failures
 * become { ok:false, ... } so the gateway can feed them back to the model.
 */
export async function fetchPublicPage(args: Record<string, unknown>): Promise<NativeExecutionResult> {
  const validated = validateFetchUrl(args.url);
  if (!validated.ok) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "invalid_url", message: validated.reason }) };
  }
  const target = validated.url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_LIMITS.timeoutMs);
  try {
    return await fetchPageWithRedirects(target, controller.signal, 0);
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, output: JSON.stringify({ ok: false, error: "fetch_timeout", message: `The page did not respond within ${WEB_FETCH_LIMITS.timeoutMs / 1000}s.` }) };
    }
    const detail = error instanceof Error ? error.name : String(error);
    return { ok: false, output: JSON.stringify({ ok: false, error: "fetch_failed", message: `The page could not be fetched (${detail}).` }) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageWithRedirects(
  url: URL,
  signal: AbortSignal,
  redirectCount: number,
): Promise<NativeExecutionResult> {
  if (redirectCount > WEB_FETCH_LIMITS.maxRedirects) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "too_many_redirects", message: "The page redirected too many times." }) };
  }
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5", "user-agent": "OstraBot/0.1 (+https://ostra.app)" },
    cache: "no-store",
  });

  // Manual redirects: re-validate every hop so redirects can never reach
  // internal hosts.
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) {
      return { ok: false, output: JSON.stringify({ ok: false, error: "fetch_failed", message: "Redirect without a location header." }) };
    }
    const next = new URL(location, url);
    const revalidated = validateFetchUrl(next.toString());
    if (!revalidated.ok) {
      return { ok: false, output: JSON.stringify({ ok: false, error: "invalid_url", message: `Redirect target refused: ${revalidated.reason}` }) };
    }
    return fetchPageWithRedirects(revalidated.url, signal, redirectCount + 1);
  }

  if (!response.ok) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "fetch_http_error", message: `The page responded with HTTP ${response.status}.` }) };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isTextLike = /text\/|application\/json|application\/xml|application\/(?:x-)?javascript/.test(contentType);
  if (!isTextLike) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "unsupported_content", message: `The page returned ${contentType || "an unknown content type"}; only text pages are supported.` }) };
  }

  // Size cap: stream-read with a hard byte ceiling.
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > WEB_FETCH_LIMITS.maxBytes) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "response_too_large", message: "The page is too large to read." }) };
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > WEB_FETCH_LIMITS.maxBytes) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "response_too_large", message: "The page is too large to read." }) };
  }

  const raw = new TextDecoder().decode(buffer);
  const text = extractReadableText(raw, contentType);
  const output = text.length > WEB_FETCH_LIMITS.maxOutputChars ? `${text.slice(0, WEB_FETCH_LIMITS.maxOutputChars)}…[truncated]` : text;
  return {
    ok: true,
    output: JSON.stringify({ ok: true, url: url.toString(), content_type: contentType, chars: output.length, content: output }),
    code: "executed",
  };
}

/** Strip scripts/styles/tags down to readable text the model can use. */
export function extractReadableText(html: string, contentType: string): string {
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    return html.replace(/\s+\n/g, "\n").trim();
  }
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// firecrawl.search — web search via the Firecrawl v2 API (native adapter)
// ---------------------------------------------------------------------------

/** Hard limits so a search can never become a server-side network hazard. */
export const FIRECRAWL_SEARCH_LIMITS = {
  maxLimit: 10,
  maxQueryChars: 400,
  timeoutMs: 20_000,
  maxOutputChars: 8_000,
} as const;

/** Wire shape of Firecrawl's v2 search response (docs.firecrawl.dev). */
interface FirecrawlSearchResponse {
  success?: unknown;
  error?: unknown;
  data?: { web?: Array<{ title?: unknown; description?: unknown; url?: unknown }> };
}

/** Read FIRECRAWL_API_KEY for the Authorization header only — never output. */
function readFirecrawlApiKey(): string | null {
  const raw = process.env.FIRECRAWL_API_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Search the web through Firecrawl's v2 search API. The key lives only in
 * the Authorization header; every failure becomes a structured, secret-free
 * result the model can read instead of a thrown error.
 */
export async function firecrawlWebSearch(args: Record<string, unknown>): Promise<NativeExecutionResult> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "invalid_query", message: "A `query` string is required." }) };
  }
  if (query.length > FIRECRAWL_SEARCH_LIMITS.maxQueryChars) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "invalid_query", message: `The query must be ${FIRECRAWL_SEARCH_LIMITS.maxQueryChars} characters or fewer.` }) };
  }
  const rawLimit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.trunc(args.limit) : 5;
  const limit = Math.min(FIRECRAWL_SEARCH_LIMITS.maxLimit, Math.max(1, rawLimit));

  const apiKey = readFirecrawlApiKey();
  if (!apiKey) {
    return { ok: false, output: JSON.stringify({ ok: false, error: "key_missing", message: "Firecrawl search is not configured: no FIRECRAWL_API_KEY on the server." }) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRECRAWL_SEARCH_LIMITS.timeoutMs);
  try {
    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, limit, sources: ["web"], timeout: FIRECRAWL_SEARCH_LIMITS.timeoutMs }),
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, output: JSON.stringify({ ok: false, error: "search_http_error", message: `The Firecrawl search API responded with HTTP ${response.status}.` }) };
    }
    const payload = (await response.json()) as FirecrawlSearchResponse;
    if (!payload || payload.success !== true || !payload.data || !Array.isArray(payload.data.web)) {
      return { ok: false, output: JSON.stringify({ ok: false, error: "search_failed", message: "The Firecrawl search API returned an unexpected response." }) };
    }
    const results = payload.data.web.slice(0, limit).map((entry) => ({
      title: typeof entry.title === "string" ? entry.title : "",
      url: typeof entry.url === "string" ? entry.url : "",
      description: typeof entry.description === "string" ? entry.description : "",
    }));
    const body = JSON.stringify({ ok: true, query, count: results.length, results });
    return {
      ok: true,
      output: body.length > FIRECRAWL_SEARCH_LIMITS.maxOutputChars ? `${body.slice(0, FIRECRAWL_SEARCH_LIMITS.maxOutputChars)}…[truncated]` : body,
      code: "executed",
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, output: JSON.stringify({ ok: false, error: "search_timeout", message: `The search did not respond within ${FIRECRAWL_SEARCH_LIMITS.timeoutMs / 1000}s.` }) };
    }
    const detail = error instanceof Error ? error.name : String(error);
    return { ok: false, output: JSON.stringify({ ok: false, error: "search_failed", message: `The Firecrawl search could not be completed (${detail}).` }) };
  } finally {
    clearTimeout(timer);
  }
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
