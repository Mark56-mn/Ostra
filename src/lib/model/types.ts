/**
 * The model abstraction.
 *
 * Everything that talks to an LLM goes through `ModelProvider`. Swapping
 * Kaggle for a VPS, a local llama.cpp server, OpenAI or an Ostra-owned model
 * server means adding a provider implementation and registering it — the web
 * app, the API route and the agent runtime stay untouched.
 */

export type ModelRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: ModelRole;
  content: string;
}

export interface GenerateOptions {
  /** Caller-owned abort signal (client disconnect, "stop" button, ...). */
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerateResult {
  /** Assistant text, already normalised to a plain string. */
  content: string;
  /** Provider id that produced the answer ("mock", "http", ...). */
  provider: string;
  /** Model identifier as reported by the provider. */
  model: string;
  latencyMs: number;
  usage?: GenerateUsage;
}

export interface ModelProvider {
  /** Stable provider id, e.g. "mock" or "http". */
  readonly id: string;
  /** Model identifier this provider is configured to call. */
  readonly model: string;
  generate(messages: ModelMessage[], options?: GenerateOptions): Promise<GenerateResult>;
}

/** Factory registered under a MODEL_MODE value. */
export type ModelProviderFactory = (config: ModelConfig) => ModelProvider;

/** Re-declared here to keep the provider contract import-cycle free. */
export interface ModelConfig {
  mode: string;
  apiUrl: string | null;
  apiKey: string | null;
  modelName: string;
  apiFormat: "openai" | "simple";
  timeoutMs: number;
}
