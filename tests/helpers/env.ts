/**
 * Shared test bootstrap: isolates process.env per test and resets every
 * memoised configuration so tests never leak state into each other.
 *
 * Run with: bun run test  (tsx + node:test)
 */
import { beforeEach } from "node:test";

const REAL_ENV = { ...process.env };

export function setEnv(patch: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/** Wipe all model/provider related env vars (but not PATH etc.). */
export function clearModelEnv(): void {
  const providerVars = [
    "AI_PROVIDER",
    "AI_MODEL",
    "AI_API_KEY",
    "AI_BASE_URL",
    "OPENROUTER_API_KEY",
    "NVIDIA_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "MODEL_MODE",
    "MODEL_API_URL",
    "MODEL_API_KEY",
    "MODEL_NAME",
    "MODEL_TIMEOUT_MS",
    "MODEL_MAX_TOKENS",
    "MODEL_TEMPERATURE",
    "OSTRA_MAX_MESSAGE_LENGTH",
  ];
  for (const key of providerVars) delete process.env[key];
}

beforeEach(() => {
  // Reset env to the process start state, then reset memoised caches.
  for (const key of Object.keys(process.env)) {
    if (!(key in REAL_ENV)) delete process.env[key];
    else process.env[key] = REAL_ENV[key];
  }
  clearModelEnv();

  // Reset memoised module state (provider config caches are module-level).
  void import("@/lib/providers/config").then((m) => m.resetProviderConfig());
  void import("@/lib/model/config").then((m) => m.resetModelConfig());
  void import("@/lib/model-selection/store").then((m) => m.modelSelectionStore.reset());
});

/** Await all pending dynamic imports from the beforeEach hook. */
export async function flushBootstrap(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
