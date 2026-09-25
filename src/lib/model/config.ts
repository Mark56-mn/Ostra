/**
 * Server-only model configuration (legacy MODEL_* layer).
 *
 * LEGACY / NOT A ROUTING AUTHORITY. Which provider and model a chat turn uses
 * is decided by the user's explicit selection in @/lib/providers/gateway.ts —
 * never by these variables. What remains here:
 *   - MODEL_API_URL / MODEL_API_KEY / MODEL_NAME are read as the ENDPOINT and
 *     CREDENTIAL CONFIGURATION of the `custom-http` provider;
 *   - MODEL_TIMEOUT_MS / MODEL_MAX_TOKENS / MODEL_TEMPERATURE are shared run
 *     parameters also used by the provider gateway;
 *   - `getMaxMessageLength()` is still used by the settings page.
 *
 * The returned config holds secrets — it must never be imported from a client
 * component and never serialised into a response.
 */
import { clampInt } from "@/lib/utils";
import type { ModelConfig } from "./types";

export type ModelMode = "mock" | "http";
export type ModelApiFormat = "openai" | "simple";

export const DEFAULT_MODEL_NAME = "ostra-experimental";
export const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 120_000;

function readString(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readString(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return clampInt(Number.isFinite(parsed) ? parsed : fallback, min, max);
}

/**
 * Resolves the legacy mode for the MODEL_* provider helpers.
 *
 * MODEL_MODE wins when set. This only affects the legacy `lib/model` helpers
 * — it cannot make the gateway pick a provider or model for a chat request.
 */
export function resolveModelMode(apiUrl: string | null): ModelMode {
  const raw = readString("MODEL_MODE")?.toLowerCase();
  if (raw === "mock") return "mock";
  if (raw === "http") return "http";
  return apiUrl ? "http" : "mock";
}

let cached: ModelConfig | null = null;

export function getModelConfig(): ModelConfig {
  if (cached) return cached;

  const apiUrl = readString("MODEL_API_URL");
  const apiFormatRaw = readString("MODEL_API_FORMAT")?.toLowerCase();

  cached = {
    mode: resolveModelMode(apiUrl),
    apiUrl,
    apiKey: readString("MODEL_API_KEY"),
    modelName: readString("MODEL_NAME") ?? DEFAULT_MODEL_NAME,
    apiFormat: apiFormatRaw === "simple" ? "simple" : "openai",
    timeoutMs: readInt("MODEL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS),
  };

  return cached;
}

/** Test/refresh helper — clears the memoised configuration. */
export function resetModelConfig(): void {
  cached = null;
}

/**
 * Public, secret-free description of the model link. This is what the API
 * layer is allowed to return to the browser.
 */
export function describeModelTarget(config: ModelConfig = getModelConfig()) {
  return {
    mode: config.mode as ModelMode,
    provider: config.mode === "http" ? "http" : "mock",
    model: config.modelName,
    endpointConfigured: Boolean(config.apiUrl),
    apiFormat: config.apiFormat,
  };
}

export function getMaxMessageLength(): number {
  return readInt("OSTRA_MAX_MESSAGE_LENGTH", 8_000, 100, 32_000);
}
