/**
 * Secret-free provider/model configuration status.
 *
 * One source of truth for /api/health, /api/status, /api/models and the
 * Settings page. Everything here is safe to expose: key *presence* only,
 * never values. Settings must not read process.env directly — this module
 * decides what is reportable.
 */
import { readTemperature } from "./env";
import { PROVIDERS } from "./registry";
import { resolveProviderConfig } from "./config";

export interface ProviderStatusInfo {
  id: string;
  name: string;
  adapter: string;
  /** Model in use for the active provider; default model otherwise. */
  model: string;
  /** True when this provider is the one AI_PROVIDER selects. */
  active: boolean;
  keyEnvVar: string;
  keyPresent: boolean;
  freeTier: boolean;
  freeTierNote: string;
  docsUrl: string;
  baseUrl: string;
}

export interface ProviderRunSettings {
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface ProviderStatusSummary {
  mode: "mock" | "provider";
  /** Resolved provider id, or "mock" / "error". */
  id: string;
  name: string;
  model: string;
  adapter: string | null;
  keyPresent: boolean;
  configError: string | null;
  /** Backward-compatible custom endpoint (MODEL_API_URL) in use. */
  legacy: boolean;
  run: ProviderRunSettings;
  providers: ProviderStatusInfo[];
}

function keyPresentFor(definition: { keyEnvVar: string }): boolean {
  return readRawEnv("AI_API_KEY") !== null || readRawEnv(definition.keyEnvVar) !== null;
}

function readRawEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getProviderStatusSummary(): ProviderStatusSummary {
  const config = resolveProviderConfig();
  const providers: ProviderStatusInfo[] = PROVIDERS.map((definition) => {
    const active = config.mode === "provider" && config.provider?.id === definition.id;
    return {
      id: definition.id,
      name: definition.name,
      adapter: definition.adapter,
      model: active && config.provider ? config.provider.model : definition.defaultModel,
      active,
      keyEnvVar: definition.keyEnvVar,
      keyPresent: keyPresentFor(definition),
      freeTier: definition.freeTier,
      freeTierNote: definition.freeTierNote,
      docsUrl: definition.docsUrl,
      baseUrl: definition.baseUrl,
    };
  });

  const run: ProviderRunSettings = {
    timeoutMs: config.provider?.timeoutMs ?? 60_000,
    maxTokens: config.provider?.maxTokens ?? 1_024,
    temperature: config.provider?.temperature ?? readTemperature(),
  };

  if (config.configError) {
    return {
      mode: "mock",
      id: "error",
      name: "Configuration error",
      model: "",
      adapter: null,
      keyPresent: false,
      configError: config.configError,
      legacy: false,
      run,
      providers,
    };
  }

  if (config.mode === "mock" || !config.provider) {
    return {
      mode: "mock",
      id: "mock",
      name: "Mock",
      model: "ostra-mock-1",
      adapter: null,
      keyPresent: false,
      configError: null,
      legacy: false,
      run,
      providers,
    };
  }

  // Provider configured — resolve the per-provider status rows with the
  // active provider's resolved model and key state.
  const provider = config.provider;
  return {
    mode: "provider",
    id: provider.id,
    name: provider.name,
    model: provider.model,
    adapter: provider.adapter,
    keyPresent: Boolean(provider.apiKey),
    configError: null,
    legacy: provider.id === "custom",
    run,
    providers,
  };
}
