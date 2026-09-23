/**
 * Vercel Connect runtime (V1) — the official mechanism, no invented auth.
 *
 * Credentials come from the deployment's Vercel OIDC token via
 * `getTokenResponse` (@vercel/connect) — short-lived, never persisted, never
 * returned to callers or placed in model context.
 *
 * Connector execution semantics per the official catalog (2026-09-21):
 * - GitHub ("managed" auth): Connect mints GitHub **installation tokens**;
 *   the REST API is called directly with `token <token>` auth.
 * - Mem0 ("mcp" auth): the connector exposes an MCP streamable-HTTP endpoint;
 *   requests are authenticated with `connectAuthProvider` from
 *   `@vercel/connect/mcp` (Bearer = the Connect-scoped token).
 *
 * Outside a Vercel OIDC environment (dev, preview, tests) every execution
 * reports `oidc_missing` honestly — nothing is faked.
 */
import { connectAuthProvider } from "@vercel/connect/mcp";
import { getTokenResponse, NoValidTokenError, UserAuthorizationRequiredError, ConnectorInstallationRequiredError } from "@vercel/connect";

// ---------------------------------------------------------------------------
// Environment gates
// ---------------------------------------------------------------------------

export type ConnectEnvState = "oidc_missing" | "oidc_present";

/** Cheap, secret-free environment check used by status and execution. */
export function getConnectEnvState(): ConnectEnvState {
  if (typeof process === "undefined" || !process.env?.VERCEL_OIDC_TOKEN) return "oidc_missing";
  return "oidc_present";
}

/**
 * Optional subject override. Connect's default subject is `{ type: "app" }`
 * (app-scoped grants, correct for this deployment). `CONNECT_SUBJECT_TYPE`
 * / `CONNECT_SUBJECT_ID` may select a user-scoped grant — server-side
 * configuration only, never client input.
 */
export function connectTokenParams(): { subject: { type: "app" } | { type: "user"; id: string } } {
  const type = process.env.CONNECT_SUBJECT_TYPE;
  const id = process.env.CONNECT_SUBJECT_ID;
  if (type === "user" && id) return { subject: { type: "user", id } };
  return { subject: { type: "app" } };
}

// ---------------------------------------------------------------------------
// Token resolution (official SDK)
// ---------------------------------------------------------------------------

/** Never logged, never serialized — exists only inside a scoped execution. */
export interface ScopedToken {
  token: string;
  expiresAt: number;
  installationId?: string;
  externalSubject?: string;
}

export interface TokenResolutionResult {
  ok: boolean;
  code:
    | "resolved"
    | "oidc_missing"
    | "not_connected"
    | "authorization_required"
    | "installation_required"
    | "connect_error";
  message: string;
  token?: ScopedToken;
}

export async function resolveScopedToken(connectorUid: string): Promise<TokenResolutionResult> {
  if (getConnectEnvState() === "oidc_missing") {
    return {
      ok: false,
      code: "oidc_missing",
      message:
        "No Vercel OIDC token in this environment — Vercel Connect integrations execute only on a Vercel deployment with the connector attached.",
    };
  }

  try {
    // forceRefresh: never serve a locally-cached grant the server may have
    // revoked — status must reflect Vercel-side truth.
    const response = await getTokenResponse(connectorUid, connectTokenParams(), { forceRefresh: true });
    return {
      ok: true,
      code: "resolved",
      message: "Scoped runtime token resolved.",
      token: {
        token: response.token,
        expiresAt: response.expiresAt,
        installationId: response.installationId,
        externalSubject: response.externalSubject,
      },
    };
  } catch (error) {
    if (error instanceof UserAuthorizationRequiredError) {
      return { ok: false, code: "authorization_required", message: "The connector requires user authorization on Vercel before it can execute." };
    }
    if (error instanceof ConnectorInstallationRequiredError) {
      return { ok: false, code: "installation_required", message: "The connector is not installed for this Vercel project." };
    }
    if (error instanceof NoValidTokenError) {
      return { ok: false, code: "not_connected", message: "No usable grant exists for this connector in this environment." };
    }
    return { ok: false, code: "connect_error", message: "Vercel Connect could not issue a scoped token." };
  }
}

// ---------------------------------------------------------------------------
// MCP client (streamable HTTP) for mcp-type connectors — Mem0
// ---------------------------------------------------------------------------

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean; [key: string]: unknown };
  error?: { code: number | string; message: string; [key: string]: unknown };
}

const MCP_TIMEOUT_MS = 20_000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Build the Authorization header value from the official Connect MCP auth
 * provider — the token never passes through Ostra code paths that could log
 * or echo it.
 */
async function mcpAuthHeader(connectorUid: string): Promise<string | null> {
  const provider = connectAuthProvider(connectorUid, connectTokenParams());
  const tokens = await provider.tokens();
  if (!tokens?.access_token) return null;
  return `Bearer ${tokens.access_token}`;
}

/**
 * Minimal MCP streamable-HTTP client for one tools/call round trip.
 * initialize → notifications/initialized → tools/call, per the MCP spec.
 * Structured failures only — never throws, never echoes auth material.
 */
export async function mcpToolCall(
  connectorUid: string,
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; code: string; message: string; text?: string }> {
  let auth: string | null;
  try {
    auth = await mcpAuthHeader(connectorUid);
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);
    if (name === "UserAuthorizationRequiredError") {
      return { ok: false, code: "authorization_required", message: "Mem0 requires user authorization on Vercel before it can execute." };
    }
    if (name === "NoValidTokenError") {
      return { ok: false, code: "not_connected", message: "No usable Mem0 grant exists in this environment." };
    }
    return { ok: false, code: "connect_error", message: "Vercel Connect could not issue a Mem0 token." };
  }
  if (!auth) {
    return { ok: false, code: "authorization_required", message: "Mem0 requires user authorization on Vercel before it can execute." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const init = (): RequestInit => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: auth,
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const initialize = await fetch(serverUrl, {
      ...init(),
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "ostra", version: "1.0.0" } },
      }),
    });
    if (!initialize.ok) {
      return { ok: false, code: initialize.status === 401 || initialize.status === 403 ? "authorization_required" : "mcp_error", message: `Mem0 MCP server rejected initialization (HTTP ${initialize.status}).` };
    }
    // Drain the init response body so the session is established on strict
    // servers that require it before the notifications/initialized step.
    await initialize.text();

    const notify = await fetch(serverUrl, {
      ...init(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    // Some servers close/202 the notification; only hard failures matter.
    if (!notify.ok && notify.status !== 202) {
      return { ok: false, code: "mcp_error", message: "Mem0 MCP server rejected the session handshake." };
    }

    const call = await fetch(serverUrl, {
      ...init(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } }),
    });
    if (!call.ok) {
      return { ok: false, code: call.status === 401 || call.status === 403 ? "authorization_required" : call.status === 429 ? "rate_limited" : "mcp_error", message: `Mem0 MCP server returned HTTP ${call.status}.` };
    }

    const contentType = call.headers.get("content-type") ?? "";
    const raw = await call.text();
    const payload = parseMcpPayload(raw, contentType);
    if (!payload) {
      return { ok: false, code: "invalid_response", message: "Mem0 MCP server returned an unreadable response." };
    }
    if (payload.error) {
      return { ok: false, code: "mcp_error", message: `Mem0 MCP tool call failed: ${String(payload.error.message).slice(0, 200)}` };
    }
    const text = (payload.result?.content ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
    if (payload.result?.isError) {
      return { ok: false, code: "tool_error", message: "Mem0 reported the operation failed.", text: text.slice(0, 500) };
    }
    return { ok: true, code: "executed", message: "Mem0 MCP tool call succeeded.", text: text.slice(0, 20_000) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, code: "timeout", message: "Mem0 did not respond in time." };
    }
    return { ok: false, code: "mcp_error", message: "Mem0 MCP request could not be completed." };
  } finally {
    clearTimeout(timer);
  }
}

function parseMcpPayload(raw: string, contentType: string): McpJsonRpcResponse | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (contentType.includes("text/event-stream")) {
    // Accept the newest JSON-RPC response-bearing event.
    const lines = trimmed.split("\n");
    let best: McpJsonRpcResponse | null = null;
    let dataBuffer: string[] = [];
    const flush = (): void => {
      if (dataBuffer.length === 0) return;
      try {
        const parsed = JSON.parse(dataBuffer.join("\n")) as McpJsonRpcResponse;
        if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) best = parsed;
      } catch {
        // Non-JSON event — ignored per SSE framing.
      }
      dataBuffer = [];
    };
    for (const line of lines) {
      if (line.startsWith("data:")) dataBuffer.push(line.slice(5).trim());
      else if (line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) continue;
      else if (line.trim() === "") flush();
    }
    flush();
    return best;
  }
  try {
    return JSON.parse(trimmed) as McpJsonRpcResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitHub REST client (managed installation tokens)
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 15_000;
const GITHUB_MAX_REPOS = 100;
const GITHUB_MAX_CHARS = 24_000;

export interface GithubRepoSummary {
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
}

export type GithubOpResult =
  | { ok: true; repos: GithubRepoSummary[]; truncated: boolean; login: string | null }
  | { ok: false; code: "invalid_url" | "http_error" | "rate_limited" | "unauthorized" | "timeout" | "network_error"; message: string };

/** List repositories visible to the Connect-managed GitHub installation. */
export async function githubListRepositories(params: { per_page?: number; page?: number; sort?: string }): Promise<GithubOpResult> {
  const resolution = await resolveScopedToken("github");
  if (!resolution.ok || !resolution.token) {
    return { ok: false, code: mapTokenCode(resolution.code), message: resolution.message };
  }

  const perPage = clampInt(params.per_page, 1, 100, 30);
  const page = clampInt(params.page, 1, 10, 1);
  const sort = params.sort === "created" || params.sort === "updated" || params.sort === "pushed" || params.sort === "full_name" ? params.sort : "updated";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=${perPage}&page=${page}&sort=${sort}`, {
      headers: {
        authorization: `token ${resolution.token.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "Ostra/1.0 (Vercel Connect)",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        return { ok: false, code: "rate_limited", message: "GitHub rate limit reached — try again shortly." };
      }
      return { ok: false, code: "unauthorized", message: "GitHub rejected the credential (installation may have been revoked or lacks repository access)." };
    }
    if (response.status === 429) {
      return { ok: false, code: "rate_limited", message: "GitHub rate limit reached — try again shortly." };
    }
    if (!response.ok) {
      return { ok: false, code: "http_error", message: `GitHub responded with HTTP ${response.status}.` };
    }

    const body = (await response.json()) as {
      total_count?: number;
      repositories?: Array<{
        full_name?: string;
        html_url?: string;
        description?: string | null;
        private?: boolean;
        fork?: boolean;
        language?: string | null;
        stargazers_count?: number;
        updated_at?: string;
      }>;
    };

    const repos: GithubRepoSummary[] = (body.repositories ?? []).slice(0, GITHUB_MAX_REPOS).map((r) => ({
      full_name: typeof r.full_name === "string" ? r.full_name : "unknown",
      html_url: typeof r.html_url === "string" ? r.html_url : "",
      description: typeof r.description === "string" ? r.description : null,
      private: r.private === true,
      fork: r.fork === true,
      language: typeof r.language === "string" ? r.language : null,
      stargazers_count: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
    }));

    const serialized = JSON.stringify({ repositories: repos });
    return {
      ok: true,
      repos,
      truncated: repos.length < (body.total_count ?? repos.length) || serialized.length > GITHUB_MAX_CHARS,
      login: (await resolution.token.externalSubject) ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, code: "timeout", message: "GitHub did not respond in time." };
    }
    return { ok: false, code: "network_error", message: "GitHub API could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Mem0 operations (MCP connector)
// ---------------------------------------------------------------------------

/**
 * MCP server endpoint for an mcp-type connector. Per the Connect model, the
 * MCP server is the PROVIDER's endpoint — Connect only supplies the auth
 * (Bearer = the Connect-scoped token). Resolution order:
 *   1. server-side env override (OSTRA_MEM0_MCP_URL)
 *   2. the connector's metadata clientUrl via getConnectorMetadata()
 *   3. Mem0's documented MCP endpoint
 */
async function mcpServerUrl(connectorUid: string): Promise<string> {
  const override = process.env.OSTRA_MEM0_MCP_URL;
  if (override) return override;
  try {
    const { getConnectorMetadata } = await import("@vercel/connect");
    const metadata = await getConnectorMetadata(connectorUid);
    if (metadata.clientUrl) return metadata.clientUrl;
  } catch {
    // Metadata unavailable — fall through to the documented endpoint.
  }
  return "https://mcp.mem0.ai/mcp";
}

export type Mem0ErrorCode =
  | "oidc_missing"
  | "not_connected"
  | "authorization_required"
  | "installation_required"
  | "connect_error"
  | "mcp_error"
  | "timeout"
  | "rate_limited"
  | "invalid_response"
  | "tool_error";

export type Mem0OpResult =
  | { ok: true; results: Array<{ text: string; score?: number }>; message: string }
  | { ok: false; code: Mem0ErrorCode; message: string };

/** Search the user's Mem0 memory via the Connect MCP connector. */
export async function mem0SearchMemory(query: string): Promise<Mem0OpResult> {
  const outcome = await mcpToolCall("mem0", await mcpServerUrl("mem0"), "search_memory", { query });
  if (!outcome.ok || typeof outcome.text !== "string") {
    return { ok: false, code: mapMcpCode(outcome.code), message: outcome.message };
  }
  const results = parseMem0Results(outcome.text);
  return { ok: true, results, message: `Retrieved ${results.length} memory result(s).` };
}

/** Persist one explicitly requested fact to Mem0 via the MCP connector. */
export async function mem0SaveMemory(text: string): Promise<Mem0OpResult> {
  const outcome = await mcpToolCall("mem0", await mcpServerUrl("mem0"), "add_memory", { text });
  if (!outcome.ok) {
    return { ok: false, code: mapMcpCode(outcome.code), message: outcome.message };
  }
  return { ok: true, results: [], message: "Memory saved." };
}

/** Parse the textual MCP result into lightweight memory entries. */
function parseMem0Results(text: string): Array<{ text: string; score?: number }> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (typeof entry === "string") return { text: entry };
          if (typeof entry === "object" && entry !== null) {
            const record = entry as Record<string, unknown>;
            const memory = typeof record.memory === "string" ? record.memory : typeof record.text === "string" ? record.text : null;
            if (memory === null) return null;
            const score = typeof record.score === "number" ? record.score : undefined;
            return { text: memory, ...(score !== undefined ? { score } : {}) };
          }
          return null;
        })
        .filter((entry): entry is { text: string; score?: number } => entry !== null)
        .slice(0, 20);
    }
  } catch {
    // Not JSON — treat the whole payload as a single textual result.
  }
  return text.trim().length > 0 ? [{ text: text.trim() }] : [];
}

function mapMcpCode(code: string): Mem0ErrorCode {
  switch (code) {
    case "oidc_missing":
    case "not_connected":
    case "authorization_required":
    case "installation_required":
    case "connect_error":
    case "mcp_error":
    case "timeout":
    case "rate_limited":
    case "invalid_response":
    case "tool_error":
      return code;
    default:
      return "mcp_error";
  }
}

function mapTokenCode(code: TokenResolutionResult["code"]): "unauthorized" | "network_error" {
  return code === "not_connected" || code === "authorization_required" || code === "installation_required" ? "unauthorized" : "network_error";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? Math.floor(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// Execution-readiness cache (status model backing)
// ---------------------------------------------------------------------------

export interface IntegrationExecutionStatus {
  registered: true;
  connected: boolean;
  authorized: boolean;
  executionReady: boolean;
  /** Secret-free reason when not execution-ready. */
  reason: string;
  checkedAt: string;
}

type ReadinessCode = "resolved" | "oidc_missing" | "not_connected" | "authorization_required" | "installation_required" | "connect_error";

interface CacheEntry {
  status: IntegrationExecutionStatus;
  expiresAt: number;
}

const READY_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 30_000;
const CACHE_TTL_BY_CODE: Record<ReadinessCode, number> = {
  resolved: READY_TTL_MS,
  oidc_missing: NEGATIVE_TTL_MS,
  not_connected: NEGATIVE_TTL_MS,
  authorization_required: NEGATIVE_TTL_MS,
  installation_required: NEGATIVE_TTL_MS,
  connect_error: NEGATIVE_TTL_MS,
};

const readinessCache = new Map<string, CacheEntry>();

function reasonFor(code: ReadinessCode): string {
  switch (code) {
    case "resolved": return "";
    case "oidc_missing": return "No Vercel OIDC token in this environment — executes on a Vercel deployment with the connector attached.";
    case "not_connected": return "No usable grant exists for this connector in this environment.";
    case "authorization_required": return "The connector requires user authorization on Vercel before it can execute.";
    case "installation_required": return "The connector is not installed for this Vercel project.";
    case "connect_error": return "Vercel Connect could not issue a scoped token.";
  }
}

/**
 * Resolve (and cache) whether an integration can execute right now. A
 * positive check mints a scoped token and discards it; a negative check
 * returns the structured, secret-free reason. Never contains token material.
 */
export async function getExecutionReadiness(integrationId: string): Promise<IntegrationExecutionStatus> {
  const cached = readinessCache.get(integrationId);
  if (cached && cached.expiresAt > Date.now()) return cached.status;

  const resolution = await resolveScopedToken(integrationId);
  const status: IntegrationExecutionStatus = {
    registered: true,
    connected: resolution.ok,
    authorized: resolution.ok,
    executionReady: resolution.ok,
    reason: reasonFor(resolution.code as ReadinessCode),
    checkedAt: new Date().toISOString(),
  };
  readinessCache.set(integrationId, { status, expiresAt: Date.now() + CACHE_TTL_BY_CODE[resolution.code as ReadinessCode] });
  return status;
}

/** Test hook: clear the readiness cache. */
export function resetExecutionReadiness(): void {
  readinessCache.clear();
}
