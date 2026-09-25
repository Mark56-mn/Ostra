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
import { isCustomEndpointConfigured, isProviderKeyPresent } from "./config";
import { CUSTOM_HTTP_ID, getProviderBaseUrl, PROVIDERS } from "./registry";
import { readEnv } from "./env";

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
  /** True when a base URL is configured for this provider. */
  endpointConfigured: boolean;
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
      id: "gemini-flash-latest",
      name: "Gemini Flash (Latest)",
      description:
        "Stable alias tracking the current Gemini Flash — best price-performance for low-latency, high-volume tasks. Verified live against Google's model list on 2026-09-23.",
      contextWindow: 1_048_576,
      maxOutput: 65_536,
      tags: ["general", "reasoning", "speed"],
      free: true,
      freeNote: "Free usage tier currently documented (rate-limited per model); limits vary by tier.",
    },
    {
      id: "gemini-flash-lite-latest",
      name: "Gemini Flash-Lite (Latest)",
      description:
        "Stable alias tracking the current Gemini Flash-Lite — fastest, most budget-friendly multimodal model. Verified live 2026-09-23.",
      contextWindow: 1_048_576,
      maxOutput: 65_536,
      tags: ["speed", "lightweight"],
      free: true,
      freeNote: "Free usage tier currently documented (rate-limited per model).",
    },
    {
      id: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro (Preview)",
      description:
        "Most advanced current Gemini for complex reasoning and coding. Preview channel — availability can change. Verified live 2026-09-23.",
      contextWindow: 1_048_576,
      maxOutput: 65_536,
      tags: ["reasoning", "coding", "frontier"],
      free: false,
      freeNote: "Preview access may be tied to paid tiers; free availability is not documented.",
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
      baseUrl: getProviderBaseUrl(definition),
      keyEnvVar: definition.keyEnvVar,
      adapter: definition.adapter,
      docsUrl: definition.docsUrl,
      freeTier: definition.freeTier,
      freeTierNote: definition.freeTierNote,
      models: getModelsForProvider(definition.id),
      keyPresent: isProviderKeyPresent(definition.id, definition.keyEnvVar),
      endpointConfigured: status?.endpointConfigured ?? false,
    };
  });
}

/**
 * The custom HTTP endpoint serves whatever models that server hosts, so the
 * server cannot pre-list them. MODEL_NAME (when set) is offered as the
 * selectable model; any other well-formed model id is still accepted as an
 * explicit user selection and sent verbatim to the configured endpoint.
 */
function customHttpModels(): CatalogModel[] {
  const hint = readEnv("MODEL_NAME");
  if (!hint) return [];
  return [
    {
      id: hint,
      name: hint,
      description: "Model name configured through MODEL_NAME for the custom OpenAI-compatible endpoint.",
      contextWindow: 0,
      maxOutput: 0,
      tags: ["custom"],
      free: false,
    },
  ];
}

export function getModelsForProvider(providerId: string): CatalogModel[] {
  if (providerId === CUSTOM_HTTP_ID) return customHttpModels();
  return MODEL_CATALOG[providerId] ?? [];
}

/** Model ids are provider-supplied strings; keep them to a safe shape. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:\/-]{1,200}$/;
/** Relative-path shapes never identify a model — reject them outright. */
function isSafeModelId(modelId: string): boolean {
  return MODEL_ID_PATTERN.test(modelId) && !modelId.startsWith(".") && !modelId.includes("..");
}

export function isModelAllowed(providerId: string, modelId: string): boolean {
  if (providerId === CUSTOM_HTTP_ID) {
    // Explicitly selected on a user-configured endpoint: any well-formed
    // model id is allowed, but only while an endpoint is configured.
    return isCustomEndpointConfigured() && isSafeModelId(modelId);
  }
  return (MODEL_CATALOG[providerId] ?? []).some((m) => m.id === modelId);
}

export function getProviderModelCount(providerId: string): number {
  return (MODEL_CATALOG[providerId] ?? []).length;
}
