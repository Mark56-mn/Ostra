/**
 * Provider registry — the single source of truth for all supported providers.
 *
 * Adding a new provider is:
 *   1. Add a ProviderDefinition to PROVIDERS
 *   2. The gateway picks it up automatically via AI_PROVIDER env var
 *
 * No frontend, route or runtime code changes needed.
 *
 * Free-tier notes must be factual and qualified — availability and limits may change.
 * See each provider's current documentation before making claims.
 */
import type { ProviderDefinition } from "./types";

export const PROVIDERS: ProviderDefinition[] = [
  // Verification note (2026-09-20): model IDs below were checked against each
  // provider's current official docs/API. Free-tier flags are deliberately
  // conservative — they describe what is documented today, not a promise.
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnvVar: "OPENROUTER_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "nvidia/nemotron-3.5-lightning:free",
    freeTier: true,
    freeTierNote: "Models with a :free suffix currently serve at $0 with rate limits. The free catalog changes frequently — verify at openrouter.ai/models?max_price=0.",
    docsUrl: "https://openrouter.ai/docs",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnvVar: "GROQ_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "openai/gpt-oss-120b",
    freeTier: false,
    freeTierNote: "No free tier currently documented. Llama models are Enterprise-only; the developer plan is usage-based (paid) with rate limits.",
    docsUrl: "https://console.groq.com/docs",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnvVar: "NVIDIA_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "nvidia/nemotron-3.5-lightning-30b-a3b",
    freeTier: true,
    freeTierNote: "Free trial credits are currently documented for the NIM API; credit availability and limits may change.",
    docsUrl: "https://docs.api.nvidia.com/nim/reference/llm-apis",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyEnvVar: "GEMINI_API_KEY",
    adapter: "gemini",
    defaultModel: "gemini-2.5-flash",
    freeTier: true,
    freeTierNote: "A Free usage tier is currently documented (rate-limited per model). Limits vary by model and tier — see ai.google.dev/gemini-api/docs/rate-limits.",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyEnvVar: "MISTRAL_API_KEY",
    adapter: "openai-compatible",
    defaultModel: "mistral-small-latest",
    freeTier: false,
    freeTierNote: "No free API tier currently documented. Paid plans include monthly API credits; the free consumer plan covers Vibe/Studio, not the API.",
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
