/**
 * Provider configuration resolver.
 *
 * Reads AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL and per-provider
 * key env vars to resolve the active provider. Falls back to mock mode
 * when no provider is configured or no key is available.
 *
 * Backward compatibility: if the legacy MODEL_MODE=http + MODEL_API_URL
 * vars are set, they are treated as a custom OpenAI-compatible provider.
 */
import { getProviderDefinition, PROVIDERS } from "./registry";
import type { ProviderHealthStatus, ResolvedProvider } from "./types";

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export type ProviderMode = "mock" | "provider";

export interface ProviderConfig {
  mode: ProviderMode;
  /** Resolved provider when mode === "provider". */
  provider: ResolvedProvider | null;
  /** Legacy: raw MODEL_API_URL when using backward-compat custom endpoint. */
  legacyApiUrl: string | null;
  legacyApiKey: string | null;
}

let cached: ProviderConfig | null = null;

/**
 * Resolve the active provider from environment variables.
 *
 * Priority:
 * 1. AI_PROVIDER + AI_MODEL (new system)
 * 2. MODEL_MODE=http + MODEL_API_URL (legacy backward compat)
 * 3. No provider → mock mode
 */
export function resolveProviderConfig(): ProviderConfig {
  if (cached) return cached;

  // --- New system: AI_PROVIDER ---
  const providerId = readEnv("AI_PROVIDER");
  if (providerId) {
    const definition = getProviderDefinition(providerId);
    if (definition) {
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
      };
      return cached;
    }
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
    };
    return cached;
  }

  // --- No provider configured → mock mode ---
  cached = {
    mode: "mock",
    provider: null,
    legacyApiUrl: null,
    legacyApiKey: null,
  };
  return cached;
}

function readTemperature(): number {
  const raw = readEnv("MODEL_TEMPERATURE");
  if (!raw) return 0.7;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0.7;
  return Math.min(2, Math.max(0, Math.round(parsed * 100) / 100));
}

/** Clear the memoised config (for tests). */
export function resetProviderConfig(): void {
  cached = null;
}

/** Safe, secret-free health status for the browser. */
export function getProviderHealthStatus(): ProviderHealthStatus {
  const config = resolveProviderConfig();
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
