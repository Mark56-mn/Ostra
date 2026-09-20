/**
 * Model selection — public API.
 */
export {
  ModelSelectionError,
  validateModelSelection,
  validateSelectionList,
  toSelectionDescriptor,
  catalogModelCount,
} from "./service";
export type { ModelSelectionErrorCode, ValidatedSelection, SelectionDescriptor } from "./service";
export { MODEL_ROLES, MODEL_ROLE_LABELS, MODEL_ROLE_DESCRIPTIONS } from "./tasks-types";
export type { ModelRole } from "./tasks-types";
