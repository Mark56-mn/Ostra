/**
 * Provider registry — the catalog of every provider Ostra can route to.
 *
 * The registry answers "which providers exist and which models do they
 * offer". It is a CATALOG, not a selector: nothing here decides which
 * provider a request uses. The user's explicit selection (per-request or the
 * workspace default) is the only routing authority.
 *
 * Adding a new provider is:
 *   1. Add a ProviderDefinition to PROVIDERS
 *   2. List its allowlisted models in src/lib/providers/catalog.ts
 *   3. Implement an adapter only if it is not OpenAI-compatible
 *
 * No frontend, route or runtime code changes needed — and no env var.
 */
import { readEnv } from "./env";
import type { ProviderDefinition } from "./types";

/** Provider id of the OpenAI-compatible custom endpoint (MODEL_API_URL). */
export const CUSTOM_HTTP_ID = "custom-http";

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
    freeTier: false,
    freeTierNote: "No free API tier currently documented. Paid plans include monthly API credits; the free consumer plan covers Vibe/Studio, not the API.",
    docsUrl: "https://docs.mistral.ai",
  },
  {
    // Any OpenAI-compatible endpoint (Kaggle tunnel, VPS, llama.cpp, vLLM…).
    // The endpoint URL is CONFIGURATION (MODEL_API_URL), never a default
    // model choice: this provider only runs when it is explicitly selected.
    id: CUSTOM_HTTP_ID,
    name: "Custom HTTP",
    // Resolved from MODEL_API_URL at call time — see getProviderBaseUrl().
    baseUrl: "",
    keyEnvVar: "MODEL_API_KEY",
    adapter: "openai-compatible",
    freeTier: false,
    freeTierNote:
      "Depends entirely on the endpoint you point MODEL_API_URL at. Costs, limits and available models are whatever that server offers.",
    docsUrl: "",
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

/**
 * Strip the well-known completion suffixes so the gateway can append
 * `/chat/completions` exactly once. A bare host stays as-is.
 */
function normalizeEndpoint(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/generate$/i, "");
}

/**
 * The base URL a provider should be called on.
 *
 * Registry providers use their fixed documented base URL. `custom-http` uses
 * the server-configured MODEL_API_URL. This is endpoint CONFIGURATION — it
 * never chooses a provider or a model.
 */
export function getProviderBaseUrl(definition: ProviderDefinition): string {
  if (definition.id !== CUSTOM_HTTP_ID) return definition.baseUrl;
  const configured = readEnv("MODEL_API_URL");
  return configured ? normalizeEndpoint(configured) : "";
}
