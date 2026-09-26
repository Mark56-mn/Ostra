/**
 * Secret-free provider configuration status.
 *
 * One source of truth for /api/health, /api/status, /api/models and the
 * Settings page. Everything here is safe to expose: key *presence* only,
 * never values. Settings must not read process.env directly — this module
 * decides what is reportable.
 *
 * There is no env-derived active provider. "active" means exactly one thing:
 * the custom OpenAI-compatible endpoint is configured (MODEL_API_URL) and
 * therefore selectable. The model that answers a request is always the
 * user's explicit selection, never a global default.
 */
import { getProviderBaseUrl, PROVIDERS } from "./registry";
import { getRunSettings, isCustomEndpointConfigured, isProviderKeyPresent } from "./config";

export interface ProviderStatusInfo {
  id: string;
  name: string;
  adapter: string;
  /** Always empty here: no model is selected by configuration alone. */
  model: string;
  /** True when the provider is usable: endpoint + credential are configured. */
  active: boolean;
  keyEnvVar: string;
  keyPresent: boolean;
  /** True when a base URL is configured for this provider. */
  endpointConfigured: boolean;
  freeTier: boolean;
  freeTierNote: string;
  docsUrl: string;
  baseUrl: string;
}

export interface ProviderRunSettings {
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface ProviderStatusSummary {
  /**
   * "unselected" — nothing is selected, the user must choose a provider and
   * model (there is no global default). "ready" — at least one provider is
   * fully configured and selectable.
   */
  mode: "unselected" | "ready";
  /** Never a provider name: Ostra has no globally active provider. */
  id: string;
  name: string;
  model: string;
  adapter: string | null;
  /**
   * True when AT LEAST ONE catalogued provider is usable — it has a
   * credential, or (for `custom-http`) an endpoint that needs no token.
   *
   * This is an "any provider" flag, not a custom-endpoint flag: it reports
   * whether the workspace has any usable provider at all. The UI shows it as
   * "selectable", so deriving it from the custom endpoint alone reported
   * "no provider keys" even when e.g. OPENROUTER_API_KEY was set.
   *
   * Per-provider truth is `providers[].keyPresent`, which for `custom-http`
   * means "endpoint configured" rather than "bearer token set" — a keyless
   * local endpoint is genuinely usable. Do not read this aggregate flag as
   * "a bearer token exists somewhere".
   */
  keyPresent: boolean;
  /** Configured custom OpenAI-compatible endpoint (MODEL_API_URL). */
  customEndpoint: boolean;
  run: ProviderRunSettings;
  providers: ProviderStatusInfo[];
}

export function getProviderStatusSummary(): ProviderStatusSummary {
  const providers: ProviderStatusInfo[] = PROVIDERS.map((definition) => {
    const endpointConfigured = Boolean(getProviderBaseUrl(definition));
    const keyPresent = isProviderKeyPresent(definition.id, definition.keyEnvVar);
    return {
      id: definition.id,
      name: definition.name,
      adapter: definition.adapter,
      model: "",
      active: endpointConfigured && keyPresent,
      keyEnvVar: definition.keyEnvVar,
      keyPresent,
      endpointConfigured,
      freeTier: definition.freeTier,
      freeTierNote: definition.freeTierNote,
      docsUrl: definition.docsUrl,
      baseUrl: getProviderBaseUrl(definition),
    };
  });

  const run = getRunSettings();
  const ready = providers.some((provider) => provider.active);
  const customEndpoint = isCustomEndpointConfigured();

  return {
    mode: ready ? "ready" : "unselected",
    id: "none",
    name: ready ? "No model selected" : "No provider configured",
    model: "",
    adapter: null,
    // "Any catalogued provider is usable". A keyless custom endpoint counts as
    // usable (that is what providers[].keyPresent means for custom-http), so
    // this stays consistent with per-provider reporting and with `mode`.
    keyPresent: providers.some((provider) => provider.keyPresent),
    customEndpoint,
    run,
    providers,
  };
}
