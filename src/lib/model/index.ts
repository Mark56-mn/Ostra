/**
 * Provider registry.
 *
 * `createModelProvider()` is the only place in Ostra that decides which model
 * backend is used. Adding a future backend (local llama.cpp, Anthropic, an
 * Ostra-owned inference server, ...) is:
 *
 *   registerModelProvider("local", (config) => new LocalModelProvider(config));
 *
 * and pointing MODEL_MODE at it. No frontend, route or runtime changes.
 */
import { getModelConfig } from "./config";
import { HttpModelProvider } from "./http-provider";
import { MockModelProvider } from "./mock-provider";
import type { ModelConfig, ModelProvider, ModelProviderFactory } from "./types";

const registry = new Map<string, ModelProviderFactory>();

registry.set("mock", () => new MockModelProvider());
registry.set("http", (config) => new HttpModelProvider(config));

export function registerModelProvider(id: string, factory: ModelProviderFactory): void {
  registry.set(id.toLowerCase(), factory);
}

export function listModelProviders(): string[] {
  return [...registry.keys()];
}

export function createModelProvider(config: ModelConfig = getModelConfig()): ModelProvider {
  const factory = registry.get(config.mode) ?? registry.get("mock");
  if (!factory) {
    throw new Error(`No model provider registered for mode "${config.mode}"`);
  }
  return factory(config);
}

let cachedProvider: ModelProvider | null = null;
let cachedKey = "";

/** Process-wide provider, recreated only when the resolved config changes. */
export function getModelProvider(): ModelProvider {
  const config = getModelConfig();
  const key = `${config.mode}|${config.apiUrl ?? ""}|${config.modelName}|${config.apiFormat}|${config.apiKey ? "keyed" : "open"}`;
  if (!cachedProvider || cachedKey !== key) {
    cachedProvider = createModelProvider(config);
    cachedKey = key;
  }
  return cachedProvider;
}

export { getModelConfig, describeModelTarget, getMaxMessageLength, resetModelConfig } from "./config";
export { ModelConfigError, ModelProviderError } from "./errors";
export type {
  GenerateOptions,
  GenerateResult,
  GenerateUsage,
  ModelConfig,
  ModelMessage,
  ModelProvider,
  ModelProviderFactory,
  ModelRole,
} from "./types";
