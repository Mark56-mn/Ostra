/**
 * Provider gateway — public API.
 *
 * Import from here to access the provider system.
 */
export { createGatewayProvider, callProvider } from "./gateway";
export {
  resolveProviderConfig,
  getProviderHealthStatus,
  getAllProviderStatuses,
  resetProviderConfig,
  isCustomEndpointConfigured,
  isProviderKeyPresent,
  getRunSettings,
} from "./config";
export { PROVIDERS, CUSTOM_HTTP_ID, getProviderDefinition, getProviderBaseUrl, listProviderIds } from "./registry";
export { getProviderStatusSummary } from "./config-status";
export {
  getModelCatalog,
  getModelsForProvider,
  isModelAllowed,
} from "./catalog";
export type { CatalogModel, CatalogProvider } from "./catalog";
export type { ProviderDefinition, ProviderHealthStatus, ResolvedProvider, ProviderAdapterType } from "./types";
export type { ProviderConfig, CustomEndpointConfig } from "./config";
export type { ProviderStatusSummary, ProviderStatusInfo } from "./config-status";
