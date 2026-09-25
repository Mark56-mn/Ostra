/**
 * Provider credential/endpoint resolution.
 *
 * IMPORTANT: this module resolves CREDENTIALS AND ENDPOINTS ONLY. It never
 * decides which provider or model a request runs on.
 *
 * There is no global default provider and no global default model. Every
 * chat turn runs on a model the user deliberately chose (a per-request
 * selection or the workspace default set in the Model Control Center), and
 * the selected provider's adapter obtains its credential from server-side
 * configuration here.
 *
 * `AI_PROVIDER` / `AI_MODEL` are no longer read anywhere: they used to make
 * an environment value the routing authority, which is exactly what this
 * architecture removed.
 */
import { readEnv, readEnvInt, readTemperature } from "./env";
import { getProviderBaseUrl, getProviderDefinition, PROVIDERS } from "./registry";
import type { ProviderHealthStatus } from "./types";

/** The explicitly configured OpenAI-compatible endpoint (MODEL_API_URL). */
export interface CustomEndpointConfig {
  /** Base URL without the `/chat/completions` suffix; "" when unconfigured. */
  baseUrl: string;
  /** Optional bearer token for that endpoint. */
  apiKey: string | null;
  /** Optional model hint from MODEL_NAME (never a default selection). */
  modelHint: string | null;
}

export interface ProviderConfig {
  customEndpoint: CustomEndpointConfig | null;
}

let cached: ProviderConfig | null = null;

/**
 * Resolve server-side provider credentials/endpoints.
 *
 * Returns configuration only. Which provider/model a request uses is decided
 * by the caller's explicit selection — see providers/gateway.ts.
 */
export function resolveProviderConfig(): ProviderConfig {
  if (cached) return cached;

  const customBaseUrl = getProviderBaseUrl(
    getProviderDefinition("custom-http") ?? {
      id: "custom-http",
      name: "Custom HTTP",
      baseUrl: "",
      keyEnvVar: "MODEL_API_KEY",
      adapter: "openai-compatible",
      freeTier: false,
      freeTierNote: "",
      docsUrl: "",
    },
  );

  cached = {
    customEndpoint: customBaseUrl
      ? { baseUrl: customBaseUrl, apiKey: readEnv("MODEL_API_KEY") ?? readEnv("AI_API_KEY"), modelHint: readEnv("MODEL_NAME") }
      : null,
  };
  return cached;
}

/** Clear the memoised config (for tests or env changes). */
export function resetProviderConfig(): void {
  cached = null;
}

/** True when the custom OpenAI-compatible endpoint is configured. */
export function isCustomEndpointConfigured(): boolean {
  return Boolean(resolveProviderConfig().customEndpoint);
}

/** Safe, secret-free per-provider key presence (used by /api/models + settings). */
export function isProviderKeyPresent(definitionId: string, keyEnvVar: string): boolean {
  const value = readEnv(keyEnvVar);
  if (value) return true;
  // A local/custom endpoint may legitimately run without a bearer token.
  return definitionId === "custom-http" && Boolean(resolveProviderConfig().customEndpoint);
}

/** Safe, secret-free health status for the browser. */
export function getProviderHealthStatus(): ProviderHealthStatus {
  const custom = resolveProviderConfig().customEndpoint;

  if (custom) {
    return {
      id: "custom-http",
      name: "Custom HTTP",
      provider: "custom-http",
      model: "",
      configured: true,
      keyPresent: Boolean(custom.apiKey),
      adapter: "openai-compatible",
      freeTier: false,
      freeTierNote: "Custom OpenAI-compatible endpoint configured via MODEL_API_URL.",
      docsUrl: "",
    };
  }

  return {
    id: "unselected",
    name: "No model selected",
    provider: "unselected",
    model: "",
    configured: false,
    keyPresent: false,
    adapter: "openai-compatible",
    freeTier: false,
    freeTierNote: "Select a provider and model — there is no global default provider or model.",
    docsUrl: "",
  };
}

/** List all providers with their configuration status (for settings). */
export function getAllProviderStatuses(): ProviderHealthStatus[] {
  return PROVIDERS.map((def) => {
    const baseUrl = getProviderBaseUrl(def);
    const keyPresent = isProviderKeyPresent(def.id, def.keyEnvVar);
    const endpointConfigured = Boolean(baseUrl);
    return {
      id: def.id,
      name: def.name,
      provider: def.name,
      model: "",
      configured: endpointConfigured && keyPresent,
      keyPresent,
      adapter: def.adapter,
      freeTier: def.freeTier,
      freeTierNote: def.freeTierNote,
      docsUrl: def.docsUrl,
    };
  });
}

/** Shared run parameters (timeout / token budget / temperature). */
export function getRunSettings(): { timeoutMs: number; maxTokens: number; temperature: number } {
  return {
    timeoutMs: readEnvInt("MODEL_TIMEOUT_MS", 60_000, 5_000, 300_000),
    maxTokens: readEnvInt("MODEL_MAX_TOKENS", 1_024, 64, 32_000),
    temperature: readTemperature(),
  };
}
