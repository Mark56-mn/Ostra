/**
 * The Ostra agent runtime.
 *
 * Version 0 scope: normalise a conversation, apply the persona, call the
 * configured ModelProvider and return a reply. It is the decision/execution
 * layer that will later grow tools, memory recall and a task queue — which is
 * why the extension points below exist even though nothing registers into
 * them yet:
 *
 *   contextProviders → memory recall / tool results injected as messages
 *   (planned) tool loop, approval gate, event log, scheduler entrypoint
 *
 * The runtime is deliberately framework-free and holds no request/Response
 * objects, so it can be driven from an HTTP route today and from a scheduler
 * or Telegram worker later.
 */
import { callProvider } from "@/lib/providers";
import type { ModelMessage } from "@/lib/model/types";
import { buildSystemPrompt } from "./persona";

export interface RuntimeInput {
  conversationId: string;
  /** Recent conversation turns, oldest first. */
  history: ModelMessage[];
  /** The new user message for this turn. */
  message: string;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /**
   * Stage 2: validated provider/model override for this turn. Must come from
   * the allowlist check in @/lib/model-selection — never raw client input.
   */
  providerOverride?: { providerId: string; modelId: string };
  /**
   * Stage 2: validated OpenRouter server-tool attachments. Must come from the
   * tool pipeline in @/lib/tools — never raw client input.
   */
  tools?: Array<{ type: string; parameters?: Record<string, unknown> }>;
  /** Server-tool step budget for this request (1–30). */
  maxToolCalls?: number;
}

export interface RuntimeResult {
  conversationId: string;
  content: string;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** Injects extra messages before the model call (memory, tools, ...). */
export type ContextProvider = (input: RuntimeInput) => ModelMessage[] | Promise<ModelMessage[]>;

export interface AgentRuntimeOptions {
  /** Overrides the persona prompt. */
  systemPrompt?: string;
  /** How many previous turns to forward to the model. */
  historyLimit?: number;
  /** Future layers register here. Empty in v0. */
  contextProviders?: ContextProvider[];
}

const DEFAULT_HISTORY_LIMIT = 24;

export class AgentRuntime {
  private readonly systemPrompt: string;
  private readonly historyLimit: number;
  private readonly contextProviders: ContextProvider[];

  constructor(options: AgentRuntimeOptions = {}) {
    this.systemPrompt = options.systemPrompt ?? buildSystemPrompt();
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.contextProviders = options.contextProviders ?? [];
  }

  async respond(input: RuntimeInput): Promise<RuntimeResult> {
    const messages = await this.buildMessages(input);

    const result = await callProvider(messages, {
      signal: input.signal,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      providerOverride: input.providerOverride,
      tools: input.tools,
      maxToolCalls: input.maxToolCalls,
    });

    return {
      conversationId: input.conversationId,
      content: result.content,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
    };
  }

  /** Assembles: persona → context layers → trimmed history → new message. */
  private async buildMessages(input: RuntimeInput): Promise<ModelMessage[]> {
    const history = input.history
      .filter((message) => message.content.trim().length > 0)
      .slice(-this.historyLimit);

    const injected: ModelMessage[] = [];
    for (const provider of this.contextProviders) {
      const messages = await provider(input);
      injected.push(...messages);
    }

    return [
      { role: "system", content: this.systemPrompt },
      ...injected,
      ...history,
      { role: "user", content: input.message },
    ];
  }
}

let runtime: AgentRuntime | null = null;

/** Shared runtime instance for the running server process. */
export function getAgentRuntime(): AgentRuntime {
  if (!runtime) {
    runtime = new AgentRuntime();
  }
  return runtime;
}