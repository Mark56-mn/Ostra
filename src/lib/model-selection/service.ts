/**
 * Model selection service (Stage 2).
 *
 * Validates a model selection against the server-controlled catalog and
 * enforces the "configured endpoint/credential required" rule: a selection
 * for a provider whose key (or, for the custom HTTP endpoint, whose
 * MODEL_API_URL) is not present is rejected rather than failing later at the
 * provider call. Every check runs server-side; nothing here trusts the
 * client beyond the shape of its request.
 */
import { getProviderStatusSummary } from "@/lib/providers/config-status";
import { getModelsForProvider, isModelAllowed } from "@/lib/providers/catalog";
import { CUSTOM_HTTP_ID } from "@/lib/providers/registry";
import { MODEL_ROLES } from "./tasks-types";
import type { ModelRole } from "./tasks-types";

export type ModelSelectionErrorCode =
  | "invalid_format"
  | "unknown_provider"
  | "model_not_allowed"
  | "key_missing"
  | "endpoint_missing"
  | "too_many_models"
  | "duplicate_role"
  | "too_many_roles";

export class ModelSelectionError extends Error {
  readonly code: ModelSelectionErrorCode;
  readonly status: number;

  constructor(code: ModelSelectionErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ModelSelectionError";
    this.code = code;
    this.status = status;
  }
}

export interface RawSelection {
  provider: unknown;
  model: unknown;
  role?: unknown;
}

export interface ValidatedSelection {
  provider: string;
  model: string;
  role: ModelRole;
}

/** A selection resolved into the exact strings the gateway/agent consumes. */
export interface SelectionDescriptor {
  providerId: string;
  modelId: string;
  role: ModelRole;
}

const MAX_SELECTED_MODELS = 5;
const MAX_ASSIGNED_ROLES = 5;

const ROLE_SET: ReadonlySet<string> = new Set(MODEL_ROLES);

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

/**
 * Validate a single { provider, model, role? } selection.
 * Throws ModelSelectionError with a safe, specific code on failure.
 */
export function validateModelSelection(raw: unknown): ValidatedSelection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ModelSelectionError("invalid_format", "A model selection must be an object with provider and model.");
  }

  const record = raw as Record<string, unknown>;
  const provider = asTrimmedString(record.provider);
  const model = asTrimmedString(record.model);
  const role = record.role === undefined || record.role === null ? "general" : asTrimmedString(record.role);

  if (!provider || provider.length > 50) {
    throw new ModelSelectionError("invalid_format", "`provider` must be a string of 1-50 characters.");
  }
  if (!model || model.length > 200) {
    throw new ModelSelectionError("invalid_format", "`model` must be a string of 1-200 characters.");
  }
  if (role && !ROLE_SET.has(role)) {
    throw new ModelSelectionError("invalid_format", `Unknown role. Valid roles: ${MODEL_ROLES.join(", ")}.`);
  }

  const summary = getProviderStatusSummary();
  const status = summary.providers.find((p) => p.id === provider);
  if (!status) {
    // Do not echo arbitrary provider strings back into the response.
    throw new ModelSelectionError("unknown_provider", "That provider is not in Ostra's allowlist.");
  }

  // The custom HTTP endpoint is user-configured: what it needs is an endpoint,
  // and a bearer token only if that server requires one.
  if (provider === CUSTOM_HTTP_ID) {
    if (!status.endpointConfigured) {
      throw new ModelSelectionError(
        "endpoint_missing",
        "The custom HTTP endpoint is not configured. Set MODEL_API_URL on the server.",
        409,
      );
    }
    if (!isModelAllowed(provider, model)) {
      throw new ModelSelectionError("model_not_allowed", "That model is not in the allowlist for this provider.");
    }
    return { provider, model, role: (role ?? "general") as ModelRole };
  }

  if (!isModelAllowed(provider, model)) {
    throw new ModelSelectionError("model_not_allowed", "That model is not in the allowlist for this provider.");
  }

  if (!status.keyPresent) {
    throw new ModelSelectionError(
      "key_missing",
      `No API key is configured for ${status.name}. Add ${status.keyEnvVar} to the server environment.`,
      409,
    );
  }

  return { provider, model, role: (role ?? "general") as ModelRole };
}

/**
 * Validate a list of selections for one task configuration.
 * Enforces the deliberate-selection cap and one-role-per-model rules.
 */
export function validateSelectionList(raw: unknown): ValidatedSelection[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ModelSelectionError("invalid_format", "`models` must be a non-empty array of selections.");
  }
  if (raw.length > MAX_SELECTED_MODELS) {
    throw new ModelSelectionError("too_many_models", `At most ${MAX_SELECTED_MODELS} models can be assigned per task.`);
  }

  const validated: ValidatedSelection[] = [];
  const seenRoles = new Set<string>();
  const seenPairs = new Set<string>();

  for (const entry of raw) {
    const selection = validateModelSelection(entry);
    const pairKey = `${selection.provider}::${selection.model}`;
    if (seenPairs.has(pairKey)) {
      throw new ModelSelectionError("invalid_format", "The same model is assigned more than once.");
    }
    if (selection.role !== "general") {
      if (seenRoles.has(selection.role)) {
        throw new ModelSelectionError("duplicate_role", `The ${selection.role} role is assigned to more than one model.`);
      }
      if (seenRoles.size >= MAX_ASSIGNED_ROLES) {
        throw new ModelSelectionError("too_many_roles", `At most ${MAX_ASSIGNED_ROLES} roles can be assigned.`);
      }
      seenRoles.add(selection.role);
    }
    seenPairs.add(pairKey);
    validated.push(selection);
  }

  return validated;
}

/** Convert a validated selection into the descriptor the gateway consumes. */
export function toSelectionDescriptor(selection: ValidatedSelection): SelectionDescriptor {
  return { providerId: selection.provider, modelId: selection.model, role: selection.role };
}

/** Test helper: number of models a provider exposes in the catalog. */
export function catalogModelCount(providerId: string): number {
  return getModelsForProvider(providerId).length;
}
