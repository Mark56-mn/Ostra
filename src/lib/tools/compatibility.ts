/**
 * Model ↔ tool compatibility (Stage 2).
 *
 * A tool can only be attached to a request when the model is verified to
 * support what the tool requires. Never silently pretends: an incompatible
 * pair produces a structured error with safe codes.
 */
import { getModelCapabilities } from "@/lib/providers/capabilities";
import { getProviderDefinition } from "@/lib/providers/registry";
import type { ToolDefinition } from "./types";

export type CompatibilityCode =
  | "unknown_provider"
  | "unknown_model"
  | "model_disabled"
  | "capability_missing"
  | "capability_unknown"
  | "tool_unknown"
  | "tool_disabled"
  | "not_connected"
  | "requires_approval"
  | "compatible";

export interface CompatibilityResult {
  compatible: boolean;
  code: CompatibilityCode;
  message: string;
  /** True when the only blocker is the approval boundary (not availability). */
  approvalRequired?: boolean;
}

export interface CompatibilityInput {
  providerId: string;
  modelId: string;
  /** Is this model the server-registered default for its provider? */
  modelIsCatalogDefault?: boolean;
  tool: ToolDefinition;
}

/**
 * Check whether a model may be given a tool. Pure and synchronous: it only
 * reads the verified capability registry, the tool registry, and provider
 * definitions — no network calls.
 */
export function checkModelToolCompatibility(input: CompatibilityInput): CompatibilityResult {
  const { tool } = input;

  const definition = getProviderDefinition(input.providerId);
  if (!definition) {
    return { compatible: false, code: "unknown_provider", message: "Provider is not registered." };
  }

  const caps = getModelCapabilities(input.providerId, input.modelId);
  if (!caps) {
    return {
      compatible: false,
      code: "unknown_model",
      message: "No verified capability data exists for that model; refusing to guess.",
    };
  }

  if (input.modelIsCatalogDefault === false) {
    return { compatible: false, code: "model_disabled", message: "That model is not currently enabled." };
  }

  const required = tool.requiredCapability;
  if (required) {
    const value = caps.capabilities[required] as boolean | "unknown" | undefined;
    if (value === false) {
      return {
        compatible: false,
        code: "capability_missing",
        message: `Model does not support the capability this tool requires (${String(required)}).`,
      };
    }
    if (value === "unknown") {
      return {
        compatible: false,
        code: "capability_unknown",
        message: `Capability "${String(required)}" is unverified for this model; refusing to guess.`,
      };
    }
    if (value === undefined) {
      return {
        compatible: false,
        code: "capability_missing",
        message: `Model has no ${String(required)} capability entry; refusing to guess.`,
      };
    }
    // value === true → fall through
  }

  if (tool.enabled === false) {
    return { compatible: false, code: "tool_disabled", message: "That tool is disabled in the registry." };
  }

  if (tool.requiresAuthentication) {
    return {
      compatible: false,
      code: "not_connected",
      message:
        "This tool runs through Vercel Connect and requires a live connection before execution. Establish the connection in the Vercel dashboard, then retry.",
    };
  }

  return { compatible: true, code: "compatible", message: "Model and tool are compatible." };
}
