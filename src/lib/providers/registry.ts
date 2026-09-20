/**
 * Provider registry — the single source of truth for all supported providers.
 *
 * Adding a new provider is:
 *   1. Add a ProviderDefinition to PROVIDERS
 *   2. The gateway picks it up automatically via AI_PROVIDER env var
 *
 * No frontend, route or runtime code changes needed.
 */
import type { ProviderDefinition } from "./types";

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnvVar: "OPENROUTER_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    freeTier: true,
    freeTierNote: "Free models available with :free suffix. Rate-limited.",
    docsUrl: "https://openrouter.ai/docs",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnvVar: "GROQ_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "llama-3.3-70b-versatile",
    freeTier: true,
    freeTierNote: "Free tier with rate limits (30 RPM on developer plan).",
    docsUrl: "https://console.groq.com/docs",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnvVar: "NVIDIA_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "nvidia/llama-3.1-nemotron-70b-instruct",
    freeTier: true,
    freeTierNote: "Free credits on signup. Check build.nvidia.com for current models.",
    docsUrl: "https://build.nvidia.com/docs",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyEnvVar: "GEMINI_API_KEY",
    adapter: "gemini",
    defaultModel: "gemini-2.5-flash",
    freeTier: true,
    freeTierNote: "Free tier with generous limits. See ai.google.dev for details.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyEnvVar: "MISTRAL_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "mistral-small-latest",
    freeTier: true,
    freeTierNote: "Free tier available for smaller models. Check docs.mistral.ai.",
    docsUrl: "https://docs.mistral.ai",
  },
];

/** Lookup a provider by its ID. Returns undefined if not found. */
export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** List all registered provider IDs. */
export function listProviderIds(): string[] {
  return PROVIDERS.map((p) => p.id);
}
