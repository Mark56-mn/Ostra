/**
 * Integration status resolution (Stage 2).
 *
 * State semantics (never conflated):
 * - available:   a matching connector exists in the current Vercel catalog
 * - connected:   a live scoped-token probe through @vercel/connect succeeded
 * - enabled:     Ostra's registry has deliberately enabled it (tier 1 default)
 * - authorized:  connected AND the runtime token carried provider scopes
 * - unavailable: no connector in the current catalog, or the probe failed
 *
 * Outside a Vercel OIDC environment (local dev, preview, tests), `connected`
 * is reported as false with an explicit note — it is never inferred as true.
 */
import { getExecutionReadiness } from "@/lib/integrations/connect-runtime";
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
}

/**
 * List integrations with honest status. `probe` = false (default) reports
 * catalog + enablement state only — cheap and side-effect free. `probe` =
 * true attempts live readiness checks per connector (rate-limited at 200
 * req/min per team; used by the explicit status endpoint). Pass `ids` to
 * restrict the check to a subset (e.g. github + mem0).
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
        };
      }

      if (!probe) {
        return {
          ...baseFields(integration),
          state: integration.enabledByDefault ? "enabled" : "available",
          connected: false,
          authorized: false,
          executionReady: false,
          executionReason: "Connection not verified — run a live status check on a Vercel deployment.",
          note: "Connector exists in the Vercel catalog. Connect it in the Vercel dashboard to enable live use.",
        };
      }

      const readiness = await getExecutionReadiness(integration.connectorUid);
      if (readiness.executionReady) {
        return {
          ...baseFields(integration),
          state: "authorized",
          connected: true,
          authorized: true,
          executionReady: true,
          executionReason: null,
          note: "Live scoped-token check succeeded — connection verified and operations can execute.",
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
): Omit<IntegrationWithStatus, "state" | "connected" | "note" | "authorized" | "executionReady" | "executionReason"> {
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
