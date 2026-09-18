/**
 * Server-only model configuration.
 *
 * Reads MODEL_* environment variables and resolves which provider the agent
 * runtime should use. The returned config holds secrets — it must never be
 * imported from a client component and never serialised into a response.
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
 * MODEL_MODE wins when set. Otherwise Ostra auto-selects: a configured
 * MODEL_API_URL means "http", an empty environment means "mock" so the
 * prototype runs out of the box.
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
