/**
 * Tool permission engine (Stage 2).
 *
 * Enforces the ordered permission ladder and the approval boundary:
 * available ≠ connected ≠ enabled ≠ authorized ≠ permitted.
 *
 * The engine decides whether a tool call may proceed immediately or must
 * surface a confirmation to the user. Stage 2 builds the boundary; richer
 * confirmation UX arrives later. Nothing here ever executes anything.
 */
import { TOOL_PERMISSIONS, type ToolDefinition, type ToolPermission } from "./types";

export type PermissionDecisionCode =
  | "allowed"
  | "denied_disabled"
  | "denied_not_connected"
  | "denied_incompatible"
  | "approval_required"
  | "unknown_tool";

export interface PermissionDecision {
  code: PermissionDecisionCode;
  /** True when the call may run now (no user confirmation needed). */
  allowed: boolean;
  /** True when the call may run after the user explicitly confirms. */
  approvalRequired: boolean;
  message: string;
}

/** Permission levels that always require explicit user confirmation. */
const ALWAYS_CONFIRM: ReadonlySet<ToolPermission> = new Set(["financial", "destructive"]);

/**
 * Decide whether a tool call is permitted for the current request.
 * `userApproved` is the explicit confirmation signal from the caller — for
 * Stage 2 API surface this is accepted only from validated request payloads.
 */
export function evaluateToolPermission(
  tool: ToolDefinition,
  context: { connected: boolean; compatible: boolean; userApproved?: boolean },
): PermissionDecision {
  // Unknown tools never reach here (registry lookup happens first), but the
  // explicit case keeps the ladder honest.
  if (!tool.enabled) {
    return {
      code: "denied_disabled",
      allowed: false,
      approvalRequired: false,
      message: "Tool is disabled in the Ostra registry.",
    };
  }

  if (tool.requiresAuthentication && !context.connected) {
    return {
      code: "denied_not_connected",
      allowed: false,
      approvalRequired: false,
      message: "Tool requires a live connection that is not established.",
    };
  }

  if (!context.compatible) {
    return {
      code: "denied_incompatible",
      allowed: false,
      approvalRequired: false,
      message: "The selected model cannot use this tool.",
    };
  }

  if (ALWAYS_CONFIRM.has(tool.permission)) {
    return context.userApproved
      ? { code: "allowed", allowed: true, approvalRequired: false, message: "Approved by explicit confirmation." }
      : {
          code: "approval_required",
          allowed: false,
          approvalRequired: true,
          message: `Tool requires explicit user confirmation (permission level ${tool.permission}).`,
        };
  }

  if (tool.requiresApproval && !context.userApproved) {
    return {
      code: "approval_required",
      allowed: false,
      approvalRequired: true,
      message: "Tool is configured to require user confirmation.",
    };
  }

  return { code: "allowed", allowed: true, approvalRequired: false, message: "Permission granted." };
}

/** Highest permission level a tool needs (registry invariant helper). */
export function permissionRank(permission: ToolPermission): number {
  return TOOL_PERMISSIONS.indexOf(permission);
}

/** Whether a tool's permission level exceeds the given ceiling. */
export function exceedsPermissionCeiling(tool: ToolDefinition, ceiling: ToolPermission): boolean {
  return permissionRank(tool.permission) > permissionRank(ceiling);
}
