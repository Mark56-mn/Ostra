/**
 * Provider gateway — public API.
 *
 * Import from here to access the provider system.
 */
export { createGatewayProvider, callProvider } from "./gateway";
export { resolveProviderConfig, getProviderHealthStatus, getAllProviderStatuses, resetProviderConfig } from "./config";
export { PROVIDERS, getProviderDefinition, listProviderIds } from "./registry";
export { getProviderStatusSummary } from "./config-status";
export {
  getModelCatalog,
  getModelsForProvider,
  isModelAllowed,
  getDefaultCatalogModel,
} from "./catalog";
export type { CatalogModel, CatalogProvider } from "./catalog";
export type { ProviderDefinition, ProviderHealthStatus, ResolvedProvider, ProviderAdapterType } from "./types";
export type { ProviderConfig, ProviderMode } from "./config";
export type { ProviderStatusSummary, ProviderStatusInfo } from "./config-status";
