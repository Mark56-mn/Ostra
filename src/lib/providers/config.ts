/**
 * Provider configuration resolver.
 *
 * Reads AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL and per-provider
 * key env vars to resolve the active provider. Falls back to mock mode
 * only when no provider is configured at all.
 *
 * Backward compatibility: if the legacy MODEL_MODE=http + MODEL_API_URL
 * vars are set, they are treated as a custom OpenAI-compatible provider.
 *
 * Invalid AI_PROVIDER values produce a clear error, NOT silent mock mode.
 */
import { readEnv, readEnvInt, readTemperature } from "./env";
import { getProviderDefinition, PROVIDERS } from "./registry";
import type { ProviderHealthStatus, ResolvedProvider } from "./types";

export type ProviderMode = "mock" | "provider";

export interface ProviderConfig {
  mode: ProviderMode;
  /** Resolved provider when mode === "provider". */
  provider: ResolvedProvider | null;
  /** Legacy: raw MODEL_API_URL when using backward-compat custom endpoint. */
  legacyApiUrl: string | null;
  legacyApiKey: string | null;
  /** Set when AI_PROVIDER is an invalid/unrecognized value. */
  configError: string | null;
}

let cached: ProviderConfig | null = null;

/**
 * Resolve the active provider from environment variables.
 *
 * Priority:
 * 1. AI_PROVIDER + AI_MODEL (new system)
 * 2. MODEL_MODE=http + MODEL_API_URL (legacy backward compat)
 * 3. No provider configured → mock mode
 *
 * If AI_PROVIDER is set to an invalid value, returns a configError.
 */
export function resolveProviderConfig(): ProviderConfig {
  if (cached) return cached;

  // --- New system: AI_PROVIDER ---
  const providerId = readEnv("AI_PROVIDER");
  if (providerId) {
    // Explicit mock is always valid — it must not be treated as an unknown provider.
    if (providerId.toLowerCase() === "mock") {
      cached = { mode: "mock", provider: null, legacyApiUrl: null, legacyApiKey: null, configError: null };
      return cached;
    }

    const definition = getProviderDefinition(providerId);
    if (!definition) {
      const validIds = PROVIDERS.map((p) => p.id).join(", ");
      cached = {
        mode: "mock",
        provider: null,
        legacyApiUrl: null,
        legacyApiKey: null,
        configError: `Invalid AI_PROVIDER="${providerId}". Valid values: ${validIds}`,
      };
      return cached;
    }

    const apiKey = readEnv("AI_API_KEY") ?? readEnv(definition.keyEnvVar);
    const model = readEnv("AI_MODEL") ?? definition.defaultModel;
    const baseUrl = readEnv("AI_BASE_URL") ?? definition.baseUrl;

    cached = {
      mode: "provider",
      provider: {
        id: definition.id,
        name: definition.name,
        baseUrl,
        apiKey,
        model,
        adapter: definition.adapter,
        timeoutMs: readEnvInt("MODEL_TIMEOUT_MS", 60_000, 5_000, 300_000),
        maxTokens: readEnvInt("MODEL_MAX_TOKENS", 1024, 64, 32_000),
        temperature: readTemperature(),
      },
      legacyApiUrl: null,
      legacyApiKey: null,
      configError: null,
    };
    return cached;
  }

  // --- Legacy backward compatibility: MODEL_MODE + MODEL_API_URL ---
  const legacyMode = readEnv("MODEL_MODE")?.toLowerCase();
  const legacyApiUrl = readEnv("MODEL_API_URL");
  if (legacyMode === "http" && legacyApiUrl) {
    const legacyApiKey = readEnv("MODEL_API_KEY");
    const legacyModel = readEnv("MODEL_NAME") ?? "ostra-experimental";

    cached = {
      mode: "provider",
      provider: {
        id: "custom",
        name: "Custom Endpoint",
        baseUrl: legacyApiUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/generate\/?$/, ""),
        apiKey: legacyApiKey,
        model: legacyModel,
        adapter: "openai-compatible",
        timeoutMs: readEnvInt("MODEL_TIMEOUT_MS", 45_000, 5_000, 300_000),
        maxTokens: readEnvInt("MODEL_MAX_TOKENS", 768, 64, 32_000),
        temperature: readTemperature(),
      },
      legacyApiUrl,
      legacyApiKey,
      configError: null,
    };
    return cached;
  }

  // --- No provider configured → mock mode ---
  cached = {
    mode: "mock",
    provider: null,
    legacyApiUrl: null,
    legacyApiKey: null,
    configError: null,
  };
  return cached;
}

/** Clear the memoised config (for tests or env changes). */
export function resetProviderConfig(): void {
  cached = null;
}

/** Safe, secret-free health status for the browser. */
export function getProviderHealthStatus(): ProviderHealthStatus {
  const config = resolveProviderConfig();

  // Invalid provider configuration
  if (config.configError) {
    return {
      id: "error",
      name: "Configuration Error",
      provider: "error",
      model: "",
      configured: false,
      keyPresent: false,
      adapter: "openai-compatible",
      freeTier: false,
      freeTierNote: config.configError,
      docsUrl: "",
    };
  }

  // Mock mode (no provider configured, or explicitly mock)
  if (config.mode === "mock" || !config.provider) {
    return {
      id: "mock",
      name: "Mock",
      provider: "mock",
      model: "ostra-mock-1",
      configured: false,
      keyPresent: false,
      adapter: "openai-compatible",
      freeTier: false,
      freeTierNote: "Simulated replies for development",
      docsUrl: "",
    };
  }

  // Provider configured — distinguish key-present from key-missing
  const definition = getProviderDefinition(config.provider.id);
  return {
    id: config.provider.id,
    name: config.provider.name,
    provider: config.provider.name,
    model: config.provider.model,
    configured: true,
    keyPresent: Boolean(config.provider.apiKey),
    adapter: config.provider.adapter,
    freeTier: definition?.freeTier ?? false,
    freeTierNote: definition?.freeTierNote ?? "",
    docsUrl: definition?.docsUrl ?? "",
  };
}

/** List all providers with their configuration status (for settings). */
export function getAllProviderStatuses(): ProviderHealthStatus[] {
  const config = resolveProviderConfig();
  return PROVIDERS.map((def) => {
    const isActive = config.provider?.id === def.id;
    const keyEnvVar = def.keyEnvVar;
    const keyPresent = Boolean(readEnv("AI_API_KEY") ?? readEnv(keyEnvVar));
    return {
      id: def.id,
      name: def.name,
      provider: def.name,
      model: isActive && config.provider ? config.provider.model : def.defaultModel,
      configured: isActive,
      keyPresent,
      adapter: def.adapter,
      freeTier: def.freeTier,
      freeTierNote: def.freeTierNote,
      docsUrl: def.docsUrl,
    };
  });
}
