/**
 * Integration status resolution (Stage 2).
 *
 * State semantics (never conflated):
 * - available:   a matching connector exists in the current Vercel catalog
 * - connected:   a live scoped-token probe through @vercel/connect succeeded
 * - enabled:     Ostra's registry has deliberately enabled it (tier 1 default)
 * - authorized:  connected AND the runtime token carried provider scopes
 * - executionReady: a concrete operation can execute right now — through a
 *   live Connect grant OR a server-side env credential (e.g. MEM0_API_KEY
 *   synced from the Vercel Marketplace integration). Credential presence is
 *   necessary for execution, never proof a call has succeeded.
 * - unavailable: no connector in the current catalog, or the probe failed
 *
 * Outside a Vercel OIDC environment (local dev, preview, tests), `connected`
 * is reported as false with an explicit note — it is never inferred as true.
 * Env credentials ARE detected locally: they are plain server-side variables.
 */
import { getExecutionReadiness, getEnvCredentialName } from "@/lib/integrations/connect-runtime";
import { getIntegration, listIntegrations, type IntegrationConnectionState, type IntegrationStatus } from "./catalog";

export interface IntegrationWithStatus extends IntegrationStatus {
  name: string;
  category: string;
  description: string;
  tier: 1 | 2;
  connectorUid: string | null;
  toolId: string | null;
  /** The integration exists in Ostra's registry (always true for listed ones). */
  registered: true;
  /** The Connect grant carried authorization (probe-mode only check). */
  authorized: boolean;
  /** A concrete operation can execute right now (live readiness check). */
  executionReady: boolean;
  /** Why it is not execution-ready — secret-free. */
  executionReason: string | null;
  /** Env var NAME (never a value) that backs execution, when present. */
  envCredential: string | null;
}

/**
 * List integrations with honest status. `probe` = false (default) reports
 * catalog + enablement + env-credential presence — cheap and side-effect
 * free. `probe` = true additionally attempts live Connect readiness checks
 * per connector (rate-limited at 200 req/min per team; used by the explicit
 * status endpoint). Pass `ids` to restrict the check to a subset.
 */
export async function getIntegrationStatuses(probe = false, ids?: string[]): Promise<IntegrationWithStatus[]> {
  const all = listIntegrations();
  const integrations = ids && ids.length > 0 ? all.filter((i) => ids.includes(i.id)) : all;

  return Promise.all(
    integrations.map(async (integration): Promise<IntegrationWithStatus> => {
      if (!integration.connectorUid) {
        return {
          ...baseFields(integration),
          state: "unavailable",
          connected: false,
          authorized: false,
          executionReady: false,
          executionReason: "No connector mapped for this integration yet.",
          note: "No connector mapped for this integration yet.",
          envCredential: getEnvCredentialName(integration.id),
        };
      }

      const envName = getEnvCredentialName(integration.id);

      if (!probe) {
        return envName !== null
          ? {
              ...baseFields(integration),
              state: integration.enabledByDefault ? "enabled" : "available",
              connected: false,
              authorized: false,
              executionReady: true,
              executionReason: null,
              note: `Server-side ${envName} credential detected — operations execute through the env-backed adapter.`,
              envCredential: envName,
            }
          : {
              ...baseFields(integration),
              state: integration.enabledByDefault ? "enabled" : "available",
              connected: false,
              authorized: false,
              executionReady: false,
              executionReason: "Connection not verified — run a live status check on a Vercel deployment.",
              note: "Connector exists in the Vercel catalog. Connect it in the Vercel dashboard to enable live use.",
              envCredential: null,
            };
      }

      const readiness = await getExecutionReadiness(integration.connectorUid);
      const envBacked = !readiness.connected && envName !== null;
      if (readiness.executionReady) {
        return {
          ...baseFields(integration),
          state: envBacked ? "enabled" : "authorized",
          connected: readiness.connected,
          authorized: readiness.authorized,
          executionReady: true,
          executionReason: null,
          note: envBacked
            ? `Credential detected (${envName}) — operations execute through the env-backed adapter.`
            : "Live scoped-token check succeeded — connection verified and operations can execute.",
          envCredential: envName,
        };
      }

      if (readiness.reason.includes("OIDC")) {
        return {
          ...baseFields(integration),
          state: "available",
          connected: false,
          authorized: false,
          executionReady: false,
          executionReason: readiness.reason,
          note: readiness.reason,
          envCredential: envName,
        };
      }

      return {
        ...baseFields(integration),
        state: "unavailable",
        connected: false,
        authorized: false,
        executionReady: false,
        executionReason: readiness.reason,
        note: readiness.reason,
        envCredential: envName,
      };
    }),
  );
}

export async function getIntegrationStatus(id: string, probe = false): Promise<IntegrationWithStatus | null> {
  const integration = getIntegration(id);
  if (!integration) return null;
  const all = await getIntegrationStatuses(probe, [id]);
  return all[0] ?? null;
}

function baseFields(
  integration: import("./catalog").IntegrationDefinition,
): Omit<IntegrationWithStatus, "state" | "connected" | "note" | "authorized" | "executionReady" | "executionReason" | "envCredential"> {
  return {
    id: integration.id,
    name: integration.name,
    provider: "vercel-connect",
    enabled: integration.enabledByDefault,
    capabilities: integration.capabilities,
    category: integration.category,
    description: integration.description,
    tier: integration.tier,
    connectorUid: integration.connectorUid,
    toolId: integration.toolId,
    registered: true,
  };
}

export type { IntegrationConnectionState, IntegrationStatus };
