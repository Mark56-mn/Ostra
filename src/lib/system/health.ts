/**
 * Builds the /api/health payload.
 *
 * Kept as a pure lib function (no next/server imports) so it can be tested
 * directly — the health contract is part of Stage 1's security surface.
 */
import { OSTRA_VERSION } from "@/lib/agent/persona";
import { getProviderStatusSummary } from "@/lib/providers/config-status";

export interface HealthPayload {
  status: "ok" | "degraded" | "unconfigured";
  system: "ostra";
  version: string;
  mode: "unselected" | "ready";
  provider: string;
  model: string;
  endpointConfigured: boolean;
  keyPresent: boolean;
  adapter: string;
  customEndpoint: boolean;
  run: { timeoutMs: number; maxTokens: number; temperature: number };
  providers: Array<{
    id: string;
    name: string;
    active: boolean;
    keyPresent: boolean;
    keyEnvVar: string;
    freeTier: boolean;
  }>;
  timestamp: string;
}

export function buildHealthPayload(now: Date = new Date()): HealthPayload {
  const summary = getProviderStatusSummary();

  // Ostra has no globally active model: "ok" means the API is healthy and at
  // least one provider is selectable. A keyless-but-present provider is
  // reported honestly rather than claimed as working.
  const status: "ok" | "degraded" | "unconfigured" = summary.mode === "ready" ? "ok" : "unconfigured";
  const selectable = summary.providers.filter((provider) => provider.active);

  return {
    status,
    system: "ostra",
    version: OSTRA_VERSION,
    mode: summary.mode,
    provider: summary.id,
    model: summary.model,
    endpointConfigured: selectable.length > 0,
    keyPresent: summary.providers.some((provider) => provider.keyPresent),
    adapter: summary.adapter ?? "openai-compatible",
    customEndpoint: summary.customEndpoint,
    run: summary.run,
    providers: summary.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      active: provider.active,
      keyPresent: provider.keyPresent,
      keyEnvVar: provider.keyEnvVar,
      freeTier: provider.freeTier,
    })),
    timestamp: now.toISOString(),
  };
}
