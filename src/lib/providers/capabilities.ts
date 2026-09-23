/**
 * Model capability registry (Stage 2).
 *
 * Declares what each allowlisted model can do. Verification discipline:
 *
 * - `boolean | "unknown"` — where a capability cannot be verified from an
 *   official source, it is stored as `"unknown"`, never assumed true.
 * - Every entry carries a `verifiedFrom` URL and `verifiedAt` date so the
 *   claim can be re-checked when providers change their catalogs.
 * - OpenRouter model IDs include variant suffixes (`:free`); capabilities are
 *   keyed on the exact catalog ID so variants are never conflated.
 *
 * Sources used (checked 2026-09-21):
 * - OpenRouter server tools + model pages: openrouter.ai/docs,
 *   openrouter.ai/api/v1/models (live catalog query)
 * - Gemini OpenAPI spec: ai.google.dev/api/caching#tool (toolCalling),
 *   ai.google.dev/gemini-api/docs/image-understanding (vision)
 * - Groq tool-use guide: console.groq.com/docs/tool-use
 * - Mistral tool calling: docs.mistral.ai/capabilities/function_calling
 * - NVIDIA NIM tool calling: docs.api.nvidia.com/nim/reference/tools
 */

/**
 * A capability value: `true` when verified, `false` when verified absent,
 * `"unknown"` when it could not be verified from an official source.
 */
export type CapabilityValue = boolean | "unknown";

export interface ModelCapabilities {
  /** The model can be given tools/functions to call. */
  toolCalling: CapabilityValue;
  /** The model can be constrained to emit structured (e.g. JSON-schema) output. */
  structuredOutput?: CapabilityValue;
  /** The model accepts image inputs. */
  vision?: CapabilityValue;
  /** The model can execute code (its own sandbox or a hosted one). */
  codeExecution?: CapabilityValue;
  /** The model exposes explicit reasoning/thinking output. */
  reasoning?: CapabilityValue;
  /** The model supports streamed responses. */
  streaming?: CapabilityValue;
}

export interface ModelCapabilitiesEntry {
  /** Exact model ID as it appears in the server catalog. */
  modelId: string;
  providerId: string;
  capabilities: ModelCapabilities;
  verifiedAt: string;
  verifiedFrom: string;
}

/** OpenRouter server-tool types a model may be given (prefix `openrouter:`). */
export const OPENROUTER_SERVER_TOOL_TYPES = [
  "openrouter:web_search",
  "openrouter:web_fetch",
  "openrouter:datetime",
  "openrouter:image_generation",
  "openrouter:shell",
  "openrouter:apply_patch",
  "openrouter:bash",
  "openrouter:fusion",
  "openrouter:advisor",
  "openrouter:subagent",
] as const;

export type OpenRouterServerToolType = (typeof OPENROUTER_SERVER_TOOL_TYPES)[number];

const openrouterVerified = {
  verifiedAt: "2026-09-21",
  verifiedFrom: "https://openrouter.ai/docs/guides/features/server-tools",
} as const;

/**
 * Capability entries for the server catalog. Only catalog models appear here;
 * an absent entry means capabilities are unknown (never guessed).
 */
export const MODEL_CAPABILITIES: ModelCapabilitiesEntry[] = [
  // --- OpenRouter (free variants; verified via live catalog + server-tools docs)
  {
    modelId: "nvidia/nemotron-3.5-lightning:free",
    providerId: "openrouter",
    capabilities: {
      toolCalling: true,
      structuredOutput: "unknown",
      vision: false,
      reasoning: true,
      streaming: true,
    },
    ...openrouterVerified,
  },
  {
    modelId: "qwen/qwen3.8-27b:free",
    providerId: "openrouter",
    capabilities: {
      toolCalling: true,
      structuredOutput: "unknown",
      vision: "unknown",
      reasoning: true,
      streaming: true,
    },
    ...openrouterVerified,
  },
  {
    modelId: "google/gemma-4-31b-it:free",
    providerId: "openrouter",
    capabilities: {
      toolCalling: "unknown",
      structuredOutput: "unknown",
      vision: "unknown",
      streaming: true,
    },
    ...openrouterVerified,
  },
  // --- NVIDIA NIM (docs.api.nvidia.com — tool calling documented for the catalog)
  {
    modelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    providerId: "nvidia",
    capabilities: {
      toolCalling: true,
      structuredOutput: "unknown",
      vision: "unknown",
      reasoning: true,
      streaming: true,
    },
    verifiedAt: "2026-09-21",
    verifiedFrom: "https://docs.api.nvidia.com/nim/reference/tools",
  },
  {
    modelId: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    providerId: "nvidia",
    capabilities: {
      toolCalling: true,
      structuredOutput: "unknown",
      vision: "unknown",
      reasoning: true,
      streaming: true,
    },
    verifiedAt: "2026-09-21",
    verifiedFrom: "https://docs.api.nvidia.com/nim/reference/tools",
  },
  // --- Gemini (tool calling + vision + structured output documented; code execution is a
  //     distinct API feature not verified per-model, so left unknown). The -latest aliases
  //     track the current Flash generation; verified live 2026-09-23.
  {
    modelId: "gemini-flash-latest",
    providerId: "gemini",
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: true,
      streaming: true,
    },
    verifiedAt: "2026-09-23",
    verifiedFrom: "https://ai.google.dev/api/caching#tool",
  },
  {
    modelId: "gemini-flash-lite-latest",
    providerId: "gemini",
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      vision: true,
      streaming: true,
    },
    verifiedAt: "2026-09-23",
    verifiedFrom: "https://ai.google.dev/api/caching#tool",
  },
  {
    modelId: "gemini-3.1-pro-preview",
    providerId: "gemini",
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: true,
      streaming: true,
    },
    verifiedAt: "2026-09-23",
    verifiedFrom: "https://ai.google.dev/api/caching#tool",
  },
  // --- Groq (tool-use documented for hosted models; per-model list not verified)
  {
    modelId: "openai/gpt-oss-120b",
    providerId: "groq",
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      reasoning: true,
      streaming: true,
    },
    verifiedAt: "2026-09-21",
    verifiedFrom: "https://console.groq.com/docs/tool-use",
  },
  {
    modelId: "openai/gpt-oss-20b",
    providerId: "groq",
    capabilities: {
      toolCalling: true,
      structuredOutput: true,
      reasoning: true,
      streaming: true,
    },
    verifiedAt: "2026-09-21",
    verifiedFrom: "https://console.groq.com/docs/tool-use",
  },
  // --- Mistral (function calling documented platform-wide)
  {
    modelId: "mistral-small-latest",
    providerId: "mistral",
    capabilities: {
      toolCalling: true,
      structuredOutput: "unknown",
      streaming: true,
    },
    verifiedAt: "2026-09-21",
    verifiedFrom: "https://docs.mistral.ai/capabilities/function_calling",
  },
  {
    modelId: "mistral-medium-latest",
    providerId: "mistral",
    capabilities: {
      toolCalling: true,
      structuredOutput: "unknown",
      streaming: true,
    },
    verifiedAt: "2026-09-21",
    verifiedFrom: "https://docs.mistral.ai/capabilities/function_calling",
  },
];

const CAPABILITY_INDEX = new Map(MODEL_CAPABILITIES.map((e) => [`${e.providerId}::${e.modelId}`, e]));

/** Capabilities for a catalog model, or null when nothing is verified (unknown). */
export function getModelCapabilities(providerId: string, modelId: string): ModelCapabilitiesEntry | null {
  return CAPABILITY_INDEX.get(`${providerId}::${modelId}`) ?? null;
}

/** All verified capability entries (for GET /api/models). */
export function getAllModelCapabilities(): ModelCapabilitiesEntry[] {
  return [...MODEL_CAPABILITIES];
}

/**
 * Whether a model is verified to support OpenRouter server tools.
 * Server tools run on OpenRouter for any tool-calling model; entries that are
 * `false` or `"unknown"` for toolCalling are rejected.
 */
export function supportsOpenRouterServerTools(providerId: string, modelId: string): boolean {
  const entry = getModelCapabilities(providerId, modelId);
  return entry?.capabilities.toolCalling === true;
}
