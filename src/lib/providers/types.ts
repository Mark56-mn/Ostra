/**
 * Provider registry types.
 *
 * Each provider describes how to reach it, which env var holds its key,
 * and which adapter handles its API shape. The gateway resolves the active
 * provider from environment variables at request time.
 */

export type ProviderAdapterType = "openai-compatible" | "gemini";

export interface ProviderDefinition {
  /** Stable ID used in AI_PROVIDER (e.g. "openrouter", "groq"). */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Base URL for the provider's API. */
  baseUrl: string;
  /** Environment variable name that holds the API key. */
  keyEnvVar: string;
  /** Which adapter handles this provider's request/response shape. */
  adapter: ProviderAdapterType;
  /** Whether this provider currently has a documented free tier. */
  freeTier: boolean;
  /** Short note about the free tier (shown in settings). */
  freeTierNote: string;
  /** URL to the provider's documentation. */
  docsUrl: string;
}

export interface ResolvedProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  adapter: ProviderAdapterType;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface ProviderHealthStatus {
  id: string;
  name: string;
  provider: string;
  model: string;
  configured: boolean;
  keyPresent: boolean;
  adapter: ProviderAdapterType;
  freeTier: boolean;
  freeTierNote: string;
  docsUrl: string;
}
