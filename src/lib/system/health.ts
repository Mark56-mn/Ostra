/**
 * Builds the /api/health payload.
 *
 * Kept as a pure lib function (no next/server imports) so it can be tested
 * directly — the health contract is part of Stage 1's security surface.
 */
import { OSTRA_VERSION } from "@/lib/agent/persona";
import { getProviderStatusSummary } from "@/lib/providers/config-status";

export interface HealthPayload {
  status: "ok" | "degraded" | "error";
  system: "ostra";
  version: string;
  mode: "mock" | "provider";
  provider: string;
  model: string;
  endpointConfigured: boolean;
  keyPresent: boolean;
  adapter: string;
  configError?: string;
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

  let status: "ok" | "degraded" | "error" = "ok";
  if (summary.configError) {
    status = "error";
  } else if (summary.mode === "provider" && !summary.keyPresent) {
    status = "degraded";
  }

  return {
    status,
    system: "ostra",
    version: OSTRA_VERSION,
    mode: summary.mode,
    provider: summary.id,
    model: summary.model,
    endpointConfigured: summary.mode === "provider" && summary.keyPresent,
    keyPresent: summary.keyPresent,
    adapter: summary.adapter ?? "openai-compatible",
    configError: summary.configError ?? undefined,
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
