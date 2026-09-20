/**
 * Server-controlled model catalog — the single source of truth for which
 * providers and models the Model Control Center can offer.
 *
 * This is an allowlist: only models listed here can be selected from the UI,
 * and every selection is validated against it server-side. API keys are never
 * part of the catalog and never leave the server.
 *
 * Verification note (2026-09-20): entries below were checked against each
 * provider's current official docs / public catalog API. Free-tier flags are
 * factual as of that date and availability may change at any time:
 * - OpenRouter: free list read live from https://openrouter.ai/api/v1/models
 * - NVIDIA: model list read from docs.api.nvidia.com/nim/reference/llm-apis
 * - Gemini: models read from ai.google.dev/gemini-api/docs/models
 * - Mistral: models read from docs.mistral.ai/models
 * - Groq: models read from console.groq.com/docs/models
 */
import { getProviderStatusSummary } from "./config-status";
import { PROVIDERS, getProviderDefinition } from "./registry";

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  maxOutput: number;
  tags: string[];
  free: boolean;
  /** Verified-current note; free: true means "documented free tier today". */
  freeNote?: string;
}

export interface CatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  keyEnvVar: string;
  adapter: string;
  docsUrl: string;
  freeTier: boolean;
  freeTierNote: string;
  models: CatalogModel[];
  keyPresent: boolean;
}

const MODEL_CATALOG: Record<string, CatalogModel[]> = {
  openrouter: [
    {
      id: "nvidia/nemotron-3.5-lightning:free",
      name: "Nemotron 3.5 Lightning (Free)",
      description:
        "NVIDIA's Nemotron 3.5 Lightning (30B-A3B MoE). Currently on OpenRouter's free list with a 1M-token context.",
      contextWindow: 1_000_000,
      maxOutput: 65_536,
      tags: ["general", "reasoning", "speed"],
      free: true,
    },
    {
      id: "qwen/qwen3.8-27b:free",
      name: "Qwen3.8 27B (Free)",
      description: "Qwen's 27B open model — strong general-purpose quality. Currently on OpenRouter's free list.",
      contextWindow: 262_144,
      maxOutput: 32_768,
      tags: ["general", "coding"],
      free: true,
    },
    {
      id: "google/gemma-4-31b-it:free",
      name: "Gemma 4 31B (Free)",
      description: "Google's open instruction-tuned model. Currently on OpenRouter's free list.",
      contextWindow: 262_144,
      maxOutput: 32_768,
      tags: ["general", "lightweight"],
      free: true,
    },
  ],
  nvidia: [
    {
      id: "nvidia/nemotron-3.5-lightning-30b-a3b",
      name: "Nemotron 3.5 Lightning 30B A3B",
      description:
        "The exact initial model named in the Ostra task. Verified against NVIDIA's current NIM model reference.",
      contextWindow: 1_000_000,
      maxOutput: 65_536,
      tags: ["general", "reasoning", "speed"],
      free: true,
      freeNote: "NIM API currently documents free trial credits; availability and limits may change.",
    },
    {
      id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      name: "Llama 3.3 Nemotron Super 49B v1.5",
      description: "NVIDIA's 49B Nemotron Super — balanced quality for its size. Verified in NVIDIA's model list.",
      contextWindow: 131_072,
      maxOutput: 8_192,
      tags: ["general", "reasoning"],
      free: true,
      freeNote: "Free trial credits currently documented; limits may change.",
    },
  ],
  gemini: [
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      description: "Best price-performance Gemini for low-latency, high-volume tasks that require reasoning.",
      contextWindow: 1_048_576,
      maxOutput: 65_536,
      tags: ["general", "reasoning", "speed"],
      free: true,
      freeNote: "Free usage tier currently documented (rate-limited per model); limits vary by tier.",
    },
    {
      id: "gemini-2.5-flash-lite",
      name: "Gemini 2.5 Flash-Lite",
      description: "The fastest, most budget-friendly multimodal model in the Gemini 2.5 family.",
      contextWindow: 1_048_576,
      maxOutput: 65_536,
      tags: ["speed", "lightweight"],
      free: true,
      freeNote: "Free usage tier currently documented (rate-limited per model).",
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      description: "The most advanced Gemini 2.5 model, for complex tasks with deep reasoning and coding.",
      contextWindow: 1_048_576,
      maxOutput: 65_536,
      tags: ["reasoning", "coding", "frontier"],
      free: false,
      freeNote: "Gemini 2.5 Pro access is tied to paid tiers; free availability is not currently documented.",
    },
  ],
  groq: [
    {
      id: "openai/gpt-oss-120b",
      name: "GPT-OSS 120B",
      description: "OpenAI's flagship open-weight model, served on Groq's LPU inference. Verified in Groq's docs.",
      contextWindow: 131_072,
      maxOutput: 65_536,
      tags: ["general", "reasoning", "speed"],
      free: false,
      freeNote: "Usage-based (paid) on Groq's developer plan; no free tier currently documented.",
    },
    {
      id: "openai/gpt-oss-20b",
      name: "GPT-OSS 20B",
      description: "Smaller GPT-OSS model, served on Groq's LPU inference. Verified in Groq's docs.",
      contextWindow: 131_072,
      maxOutput: 65_536,
      tags: ["speed", "lightweight"],
      free: false,
      freeNote: "Usage-based (paid) on Groq's developer plan.",
    },
  ],
  mistral: [
    {
      id: "mistral-small-latest",
      name: "Mistral Small",
      description: "Balanced small model for general tasks; alias tracks Mistral's current Small version.",
      contextWindow: 131_072,
      maxOutput: 8_192,
      tags: ["general", "coding"],
      free: false,
      freeNote: "API access is paid; plans include monthly API credits rather than a free API tier.",
    },
    {
      id: "mistral-medium-latest",
      name: "Mistral Medium",
      description: "Frontier-class multimodal model for agentic and coding use cases; alias tracks the current version.",
      contextWindow: 131_072,
      maxOutput: 8_192,
      tags: ["reasoning", "coding", "frontier"],
      free: false,
    },
  ],
};

/** Full catalog plus live key-presence — safe for GET /api/models. */
export function getModelCatalog(): CatalogProvider[] {
  const summary = getProviderStatusSummary();
  const byId = new Map(summary.providers.map((p) => [p.id, p]));

  return PROVIDERS.map((definition) => {
    const status = byId.get(definition.id);
    return {
      id: definition.id,
      name: definition.name,
      baseUrl: definition.baseUrl,
      keyEnvVar: definition.keyEnvVar,
      adapter: definition.adapter,
      docsUrl: definition.docsUrl,
      freeTier: definition.freeTier,
      freeTierNote: definition.freeTierNote,
      models: MODEL_CATALOG[definition.id] ?? [],
      keyPresent: status?.keyPresent ?? false,
    };
  });
}

export function getModelsForProvider(providerId: string): CatalogModel[] {
  return MODEL_CATALOG[providerId] ?? [];
}

export function isModelAllowed(providerId: string, modelId: string): boolean {
  return (MODEL_CATALOG[providerId] ?? []).some((m) => m.id === modelId);
}

export function getProviderModelCount(providerId: string): number {
  return (MODEL_CATALOG[providerId] ?? []).length;
}

/** The verified default model for a provider — the model the UI preselects. */
export function getDefaultCatalogModel(providerId: string): CatalogModel | null {
  const definition = getProviderDefinition(providerId);
  if (!definition) return null;
  return (MODEL_CATALOG[providerId] ?? []).find((m) => m.id === definition.defaultModel) ?? null;
}
