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
import { probeConnector } from "@/lib/tools/executor";
import { getIntegration, listIntegrations, type IntegrationConnectionState, type IntegrationStatus } from "./catalog";

export interface IntegrationWithStatus extends IntegrationStatus {
  name: string;
  category: string;
  description: string;
  tier: 1 | 2;
  connectorUid: string | null;
  toolId: string | null;
}

/**
 * List integrations with honest status. `probe` = false (default) reports
 * catalog + enablement state only — cheap and side-effect free. `probe` =
 * true attempts live scoped-token probes per connector (rate-limited at 200
 * req/min per team; used by the explicit status endpoint).
 */
export async function getIntegrationStatuses(probe = false): Promise<IntegrationWithStatus[]> {
  const integrations = listIntegrations();

  return Promise.all(
    integrations.map(async (integration): Promise<IntegrationWithStatus> => {
      if (!integration.connectorUid) {
        return {
          ...baseFields(integration),
          state: "unavailable",
          connected: false,
          note: "No connector mapped for this integration yet.",
        };
      }

      if (!probe) {
        return {
          ...baseFields(integration),
          state: integration.enabledByDefault ? "enabled" : "available",
          connected: false,
          note: "Connector exists in the Vercel catalog. Connect it in the Vercel dashboard to enable live use.",
        };
      }

      const probeResult = await probeConnector(
        {
          id: integration.toolId ?? integration.id,
          requiresAuthentication: true,
          executionType: "vercel-connect",
        } as Parameters<typeof probeConnector>[0],
        { connectorUid: integration.connectorUid },
      );

      if (probeResult.ok) {
        return {
          ...baseFields(integration),
          state: "authorized",
          connected: true,
          note: "Live scoped-token probe succeeded — connection verified.",
        };
      }

      if (probeResult.code === "oidc_missing") {
        return {
          ...baseFields(integration),
          state: "available",
          connected: false,
          note: probeResult.message,
        };
      }

      return {
        ...baseFields(integration),
        state: "unavailable",
        connected: false,
        note: probeResult.message,
      };
    }),
  );
}

export async function getIntegrationStatus(id: string, probe = false): Promise<IntegrationWithStatus | null> {
  const integration = getIntegration(id);
  if (!integration) return null;
  const all = await getIntegrationStatuses(probe);
  return all.find((i) => i.id === id) ?? null;
}

function baseFields(integration: import("./catalog").IntegrationDefinition): Omit<IntegrationWithStatus, "state" | "connected" | "note"> {
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
  };
}

export type { IntegrationConnectionState, IntegrationStatus };
