/**
 * Tool registry types (Stage 2).
 *
 * Provider-independent: the registry describes *what* a tool is and *what it
 * is allowed to do*. Provider-specific execution happens in adapters
 * (see ./executor.ts), never in these definitions.
 */

/** Ordered permission levels, from least to most consequential. */
export const TOOL_PERMISSIONS = ["read", "write", "execute", "external_action", "financial", "destructive"] as const;

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

export const TOOL_PERMISSION_LABELS: Record<ToolPermission, string> = {
  read: "READ",
  write: "WRITE",
  execute: "EXECUTE",
  external_action: "EXTERNAL_ACTION",
  financial: "FINANCIAL",
  destructive: "DESTRUCTIVE",
};

/** Where the tool actually runs. Execution logic lives in matching adapters. */
export const TOOL_EXECUTION_TYPES = ["openrouter", "vercel-connect", "native", "external"] as const;

export type ToolExecutionType = (typeof TOOL_EXECUTION_TYPES)[number];

export const TOOL_RISK_LEVELS = ["low", "medium", "high"] as const;

export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

/**
 * Provider-independent tool definition. `inputSchema` is a JSON Schema
 * (validated at request time by zod conversion) so adapters never trust raw
 * client payloads.
 */
export interface ToolDefinition {
  id: string;
  name: string;
  /** Infrastructure the tool runs through — not the model provider. */
  provider: string;
  category: string;
  description: string;
  /** JSON Schema for tool arguments. */
  inputSchema: unknown;
  outputSchema?: unknown;
  /** Whether Ostra has an enabled execution path for it (server-side gate). */
  enabled: boolean;
  /** Whether it needs a credential/connection (Vercel Connect, API key, …). */
  requiresAuthentication: boolean;
  executionType: ToolExecutionType;
  /** Model capability required to invoke the tool (e.g. "toolCalling"). */
  requiredCapability?: keyof import("@/lib/providers/capabilities").ModelCapabilities;
  riskLevel: ToolRiskLevel;
  /** Highest permission level this tool needs. */
  permission: ToolPermission;
  /** Default approval requirement for consequential operations. */
  requiresApproval: boolean;
}

/** Tool entry enriched with live runtime status — safe for GET /api/tools. */
export interface ToolStatus extends ToolDefinition {
  /** Whether the execution path is currently usable (key/connection present). */
  available: boolean;
  /** Human-readable reason when unavailable. */
  unavailableReason?: string;
}

/** Resolution outcome for a tool request against the current environment. */
export type ToolResolutionState =
  | "available"
  | "disabled"
  | "unknown"
  | "not_connected"
  | "requires_approval"
  | "incompatible_model";

export interface ToolResolution {
  toolId: string;
  state: ToolResolutionState;
  /** Why the tool is (un)available — never includes secret values. */
  reason: string;
}
