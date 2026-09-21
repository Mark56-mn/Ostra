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

/**
 * A native tool exposed to the model as an OpenAI-style function definition.
 * The model emits a tool call; the gateway executes it server-side through
 * Ostra's tool pipeline and continues the conversation with the result.
 */
export interface FunctionToolAttachment {
  /** Wire-safe function name ([a-zA-Z0-9_-]) the model calls. */
  name: string;
  description: string;
  /** JSON Schema for the function arguments. */
  parameters: Record<string, unknown>;
  /** Ostra tool id this function maps back to (e.g. "ostra:noop"). */
  toolId: string;
}

/** A tool call the model asked for (OpenAI `tool_calls` entry). */
export interface ModelToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface GenerateOptions {
  /** Caller-owned abort signal (client disconnect, "stop" button, ...). */
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /**
   * Stage 2: per-request provider/model override. Must be validated against
   * the server-side allowlist before it reaches the gateway.
   */
  providerOverride?: { providerId: string; modelId: string };
  /**
   * Stage 2: OpenRouter server-tool attachments (`openrouter:*` types).
   * Must come from the tool registry and pass model/tool compatibility
   * before reaching the gateway. OpenRouter executes these server-side.
   */
  tools?: Array<{ type: string; parameters?: Record<string, unknown> }>;
  /**
   * Stage 2: native tools exposed as functions the model may call. The
   * gateway runs the tool-call loop (call → execute → continue → final).
   */
  functionTools?: FunctionToolAttachment[];
  /** Tool budget: OpenRouter server-tool steps (1–30) and client-loop hops. */
  maxToolCalls?: number;
}

export interface GenerateUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Citation extracted from server-tool annotations (e.g. web search). */
export interface ToolSource {
  url: string;
  title?: string;
}

/** What actually happened with tools during one generate call. */
export interface ToolUsage {
  /** Ostra tool ids executed through the client tool-call loop. */
  clientToolCalls: string[];
  /** Number of OpenRouter server-tool steps the provider reported. */
  serverToolSteps: number;
  /** Citations returned by server tools (web search/fetch). */
  sources: ToolSource[];
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
  /** Present when any tool activity occurred during the call. */
  toolUsage?: ToolUsage;
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
