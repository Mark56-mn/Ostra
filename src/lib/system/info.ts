import { resolveProviderConfig } from "@/lib/providers";

/**
 * Describes the currently active provider for health/status reporting.
 * No secrets are included.
 */
export interface ActiveProviderInfo {
  id: string;
  modelId: string;
  isConfigured: boolean;
  format: string;
  keyPresent: boolean;
  configError: string | null;
}

/**
 * Returns info about the active provider (safe to expose to the client).
 */
export function getActiveProviderConfig(): ActiveProviderInfo {
  const config = resolveProviderConfig();

  if (config.configError) {
    return {
      id: "error",
      modelId: "",
      isConfigured: false,
      format: "",
      keyPresent: false,
      configError: config.configError,
    };
  }

  if (config.mode === "mock" || !config.provider) {
    return {
      id: "mock",
      modelId: "ostra-mock-1",
      isConfigured: false,
      format: "openai",
      keyPresent: false,
      configError: null,
    };
  }

  return {
    id: config.provider.id,
    modelId: config.provider.model,
    isConfigured: true,
    format: config.provider.adapter,
    keyPresent: Boolean(config.provider.apiKey),
    configError: null,
  };
}

/** System info shape returned by /api/health. */
export interface SystemInfo {
  status: "ok" | "degraded" | "error";
  system: string;
  version: string;
  mode: string;
  provider: string;
  model: string;
  endpointConfigured: boolean;
  keyPresent: boolean;
  adapter: string;
  configError?: string;
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
}

/** Error body shape returned by all Ostra API error paths. */
export interface ApiErrorBody {
  error: { code: string; message: string };
  requestId?: string;
}
