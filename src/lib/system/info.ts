import { getProviderStatusSummary } from "@/lib/providers/config-status";

/**
 * Describes the configured model link for health/status reporting.
 * No secrets are included.
 *
 * There is no globally active provider: Ostra has no default model. What is
 * reported here is whether any provider is usable and whether the custom
 * OpenAI-compatible endpoint is configured. The model that answers a chat is
 * always the user's explicit selection (see POST /api/chat).
 */
export interface ActiveProviderInfo {
  id: string;
  modelId: string;
  isConfigured: boolean;
  format: string;
  keyPresent: boolean;
  customEndpoint: boolean;
}

/** Returns safe model-link configuration info (no secrets). */
export function getActiveProviderConfig(): ActiveProviderInfo {
  const summary = getProviderStatusSummary();
  return {
    id: summary.id,
    modelId: summary.model,
    isConfigured: summary.mode === "ready",
    format: summary.adapter ?? "openai-compatible",
    keyPresent: summary.keyPresent,
    customEndpoint: summary.customEndpoint,
  };
}

/** System info shape returned by /api/health. */
export interface SystemInfo {
  status: "ok" | "degraded" | "unconfigured";
  system: string;
  version: string;
  mode: string;
  provider: string;
  model: string;
  endpointConfigured: boolean;
  keyPresent: boolean;
  adapter: string;
  run?: { timeoutMs: number; maxTokens: number; temperature: number };
  providers?: Array<{
    id: string;
    name: string;
    active: boolean;
    keyPresent: boolean;
    keyEnvVar: string;
    freeTier: boolean;
  }>;
  timestamp: string;
}

/** Chat API success shape returned by POST /api/chat. */
export interface ChatApiSuccess {
  message: string;
  conversationId: string;
  model: string;
  provider: string;
  mode: "mock" | "live";
  latencyMs: number;
  /** Echo of the effective provider/model that answered this turn. */
  requested: { provider: string; model: string } | null;
  /**
   * Where the effective selection came from: this request's `model` field, or
   * the deliberate workspace default. There is no env-derived source.
   */
  selectionSource: "request" | "workspace";
  /** Ostra native tool ids that executed during the turn (empty = none). */
  toolsUsed: string[];
  /** Provider-reported server-tool steps (OpenRouter web search/fetch). */
  serverToolSteps?: number;
  /** Citation URLs from server-side web search/fetch, when any. */
  sources?: Array<{ url: string; title?: string }>;
  /** True when persistent-memory recall injected context for this turn. */
  memoryRecalled?: boolean;
}

/** Error body shape returned by all Ostra API error paths. */
export interface ApiErrorBody {
  error: { code: string; message: string };
  requestId?: string;
}
