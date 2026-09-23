/**
 * Tool resolution pipeline (Stage 2).
 *
 * Requested tool
 *   → registry lookup          (unknown → structured error)
 *   → config store             (enabled? approval policy?)
 *   → execution-type adapter   (openrouter | native | vercel-connect | external)
 *   → model compatibility      (verified capabilities only)
 *   → permission engine        (read/write/execute/external/financial/destructive)
 *   → adapter execution or refusal
 *
 * Every refusal returns a structured, secret-free reason. Nothing here ever
 * exposes credentials or pretends a tool ran.
 */
import { checkModelToolCompatibility, type CompatibilityResult } from "./compatibility";
import { toolConfigStore } from "./config";
import { buildOpenRouterToolSpecs, executeConnectOperation, executeNativeTool, lookupConnector, probeConnector } from "./executor";
import { evaluateToolPermission, type PermissionDecision } from "./permissions";
import { getToolDefinition, listToolDefinitions } from "./registry";
import type { ToolDefinition, ToolStatus } from "./types";
import { validateToolArgs } from "./validate-args";

export type ToolErrorCode =
  | "unknown_tool"
  | "tool_disabled"
  | "not_connected"
  | "incompatible_model"
  | "requires_approval"
  | "invalid_args"
  | "invalid_schema"
  | "unsupported_execution"
  | "execution_failed"
  | "invalid_format";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly status: number;

  constructor(code: ToolErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.status = status;
  }
}

export interface ToolRequestContext {
  providerId?: string;
  modelId?: string;
  userApproved?: boolean;
}

/**
 * Resolve a tool's current state for the control center and for execution
 * decisions. `connected` is computed lazily only where a connection probe is
 * meaningful (Vercel Connect tools; requires a live OIDC environment).
 */
export interface ResolvedTool extends ToolStatus {
  compatibility?: CompatibilityResult;
  /** Permission-engine decision — distinct from the tool's static `permission` level. */
  permissionDecision?: PermissionDecision;
}

export function resolveTool(toolId: string, context: ToolRequestContext = {}): ResolvedTool {
  const tool = getToolDefinition(toolId);
  if (!tool) {
    throw new ToolError("unknown_tool", "That tool is not in Ostra's registry.", 404);
  }

  const enabled = toolConfigStore.isEnabled(tool);
  const requiresApproval = toolConfigStore.requiresApproval(tool);
  const resolved: ResolvedTool = {
    ...tool,
    enabled,
    requiresApproval,
    available: enabled && !tool.requiresAuthentication,
  };

  if (context.providerId && context.modelId) {
    resolved.compatibility = checkModelToolCompatibility({
      providerId: context.providerId,
      modelId: context.modelId,
      tool,
    });
    if (resolved.compatibility.compatible) {
      resolved.permissionDecision = evaluateToolPermission(tool, { connected: !tool.requiresAuthentication, compatible: true, userApproved: context.userApproved });
    }
  }

  return resolved;
}

/** All tools with their config-store state — used by GET /api/tools. */
export function getAllToolStatuses(): ToolStatus[] {
  return listToolDefinitions().map((tool) => {
    const enabled = toolConfigStore.isEnabled(tool);
    return {
      ...tool,
      enabled,
      requiresApproval: toolConfigStore.requiresApproval(tool),
      available: enabled && !tool.requiresAuthentication,
    };
  });
}

export async function getToolConnectionStatus(toolId: string): Promise<{
  toolId: string;
  executionType: ToolDefinition["executionType"];
  connectorUid: string | null;
  unmapped: boolean;
  connected: boolean | "unverifiable";
  message: string;
}> {
  const tool = getToolDefinition(toolId);
  if (!tool) throw new ToolError("unknown_tool", "That tool is not in Ostra's registry.", 404);
  if (tool.executionType !== "vercel-connect") {
    return {
      toolId,
      executionType: tool.executionType,
      connectorUid: null,
      unmapped: false,
      connected: tool.requiresAuthentication ? false : true,
      message: "Tool does not run through Vercel Connect.",
    };
  }

  const { connectorUid, unmapped } = lookupConnector(toolId);
  if (unmapped) {
    return { toolId, executionType: tool.executionType, connectorUid: null, unmapped: true, connected: false, message: "No Vercel Connect connector has been mapped for this tool yet." };
  }
  if (!connectorUid) {
    return { toolId, executionType: tool.executionType, connectorUid: null, unmapped: false, connected: false, message: "No equivalent connector exists in the current Vercel Connect catalog." };
  }

  const probe = await probeConnector(tool, { connectorUid });
  return {
    toolId,
    executionType: tool.executionType,
    connectorUid,
    unmapped: false,
    connected: probe.ok ? true : probe.code === "oidc_missing" ? "unverifiable" : false,
    message: probe.message,
  };
}

/**
 * Validate a tool for use with a model — the endpoint /api/tools/validate
 * backs. Structured refusals with safe codes; never throws for expected
 * incompatibilities.
 */
export function evaluateToolForModel(input: {
  toolId: unknown;
  provider: unknown;
  model: unknown;
}): { ok: false; status: number; code: ToolErrorCode; message: string } | { ok: true; result: CompatibilityResult & { permission?: PermissionDecision } } {
  if (typeof input.toolId !== "string" || typeof input.provider !== "string" || typeof input.model !== "string") {
    return { ok: false, status: 400, code: "invalid_format", message: "toolId, provider and model are required strings." };
  }

  const tool = getToolDefinition(input.toolId);
  if (!tool) {
    return { ok: false, status: 404, code: "unknown_tool", message: "That tool is not in Ostra's registry." };
  }

  const enabled = toolConfigStore.isEnabled(tool);
  if (!enabled) {
    return { ok: false, status: 409, code: "tool_disabled", message: "That tool is disabled in the Ostra registry." };
  }

  const compatibility = checkModelToolCompatibility({ providerId: input.provider, modelId: input.model, tool });
  if (!compatibility.compatible && compatibility.code !== "not_connected") {
    return { ok: false, status: 409, code: mapCompatibilityCode(compatibility.code), message: compatibility.message };
  }

  const permission = evaluateToolPermission(tool, {
    connected: !tool.requiresAuthentication,
    compatible: compatibility.compatible,
    userApproved: false,
  });

  if (!permission.allowed && !permission.approvalRequired) {
    return { ok: false, status: 409, code: mapCompatibilityCode(compatibility.code), message: permission.message };
  }

  return { ok: true, result: { ...compatibility, permission } };
}

export interface ExecuteToolResult {
  toolId: string;
  state: "executed" | "attached" | "refused";
  output?: string;
  /** Present when the tool is an OpenRouter server tool: request attachment. */
  attachment?: { tools: Array<{ type: string; parameters?: Record<string, unknown> }>; maxToolCalls: number };
  decision?: PermissionDecision;
}

/**
 * Execute a native tool after full pipeline checks. OpenRouter server tools
 * are never executed here — they return an attachment spec for the model
 * gateway instead (the model decides when to call them mid-request).
 */
export async function executeTool(
  toolId: unknown,
  args: unknown,
  context: ToolRequestContext = {},
): Promise<ExecuteToolResult> {
  if (typeof toolId !== "string") {
    throw new ToolError("invalid_format", "`toolId` must be a string.");
  }

  const tool = getToolDefinition(toolId);
  if (!tool) {
    throw new ToolError("unknown_tool", "That tool is not in Ostra's registry.", 404);
  }

  if (!toolConfigStore.isEnabled(tool)) {
    throw new ToolError("tool_disabled", "That tool is disabled in the Ostra registry.", 409);
  }

  // Compatibility gate when a model context is provided.
  if (context.providerId && context.modelId) {
    const compatibility = checkModelToolCompatibility({ providerId: context.providerId, modelId: context.modelId, tool });
    if (!compatibility.compatible) {
      throw new ToolError("incompatible_model", compatibility.message, 409);
    }
  }

  const decision = evaluateToolPermission(tool, {
    // Integration operations: connection is verified live via the Connect
    // runtime (readiness check). Everything else keeps the registry gate.
    connected: !tool.requiresAuthentication || (await isConnectedLive(tool)),
    compatible: !context.providerId || !context.modelId || checkModelToolCompatibility({ providerId: context.providerId, modelId: context.modelId, tool }).compatible,
    userApproved: context.userApproved,
  });

  if (!decision.allowed && !decision.approvalRequired) {
    throw new ToolError(mapDecisionCode(decision.code), decision.message, 409);
  }
  if (decision.approvalRequired && !context.userApproved) {
    throw new ToolError("requires_approval", decision.message, 403);
  }

  // Validate args against the registry schema BEFORE any adapter runs.
  const validation = validateToolArgs(tool.id, tool.inputSchema, args);
  if (!validation.ok) {
    throw new ToolError(validation.code === "invalid_schema" ? "invalid_schema" : "invalid_args", validation.message, 400);
  }

  switch (tool.executionType) {
    case "openrouter": {
      // Server tools run inside the model request. Hand back the attachment
      // spec; the gateway attaches it and OpenRouter executes server-side.
      const spec = buildOpenRouterToolSpecs([tool]);
      return { toolId: tool.id, state: "attached", attachment: spec, decision };
    }
    case "native": {
      const result = await executeNativeTool(tool, validation.args);
      if (!result.ok) {
        throw new ToolError("execution_failed", result.output, 502);
      }
      return { toolId: tool.id, state: "executed", output: result.output, decision };
    }
    case "vercel-connect": {
      // V1: concrete operations (github.list_repositories, mem0.*) execute
      // through the official Connect runtime. Generic connect:* passthrough
      // tools still refuse honestly — only registered operations exist.
      const result = await executeConnectOperation(tool.id, validation.args);
      if (!result.ok) {
        throw new ToolError(mapConnectCode(result.code), safeConnectMessage(result.code, tool.id), 502);
      }
      return { toolId: tool.id, state: "executed", output: result.output, decision };
    }
    case "external": {
      throw new ToolError("unsupported_execution", "External tool execution is not implemented in Stage 2.", 501);
    }
  }
}

function mapCompatibilityCode(code: string): ToolErrorCode {
  switch (code) {
    case "unknown_provider":
    case "unknown_model":
      return "incompatible_model";
    case "capability_missing":
    case "capability_unknown":
      return "incompatible_model";
    case "tool_disabled":
      return "tool_disabled";
    case "not_connected":
      return "not_connected";
    default:
      return "incompatible_model";
  }
}

function mapDecisionCode(code: string): ToolErrorCode {
  switch (code) {
    case "denied_disabled":
      return "tool_disabled";
    case "denied_not_connected":
      return "not_connected";
    case "denied_incompatible":
      return "incompatible_model";
    default:
      return "execution_failed";
  }
}

/**
 * Live connection check for tools that require authentication. Only
 * integration operations go through the Connect runtime's readiness check
 * (which also proves authorization); everything else keeps the registry gate.
 */
async function isConnectedLive(tool: ToolDefinition): Promise<boolean> {
  if (tool.executionType !== "vercel-connect") return false;
  if (tool.id.startsWith("connect:")) return false;
  const { getExecutionReadiness } = await import("@/lib/integrations/connect-runtime");
  const readiness = await getExecutionReadiness(tool.provider);
  return readiness.executionReady;
}

function mapConnectCode(code: string): ToolErrorCode {
  switch (code) {
    case "oidc_missing":
    case "not_connected":
    case "authorization_required":
    case "installation_required":
    case "unauthorized":
      return "not_connected";
    case "rate_limited":
      return "execution_failed";
    case "unsupported_execution":
      return "unsupported_execution";
    default:
      return "execution_failed";
  }
}

/**
 * Safe, tool-specific refusal message — never echoes upstream error bodies,
 * which could contain credential material.
 */
function safeConnectMessage(code: string, toolId: string): string {
  const toolName = toolId.split(".")[0].toUpperCase();
  switch (code) {
    case "oidc_missing":
      return `${toolName} is registered but this environment has no Vercel OIDC token — integration tools execute on a Vercel deployment with the connector attached.`;
    case "not_connected":
    case "unauthorized":
      return `${toolName} is registered but not execution-ready: no usable connection grant is available.`;
    case "authorization_required":
      return `${toolName} is connected but requires user authorization on Vercel before it can execute.`;
    case "installation_required":
      return `${toolName} connector is not installed for this Vercel project.`;
    case "rate_limited":
      return `${toolName} is rate-limited right now — try again shortly.`;
    case "timeout":
      return `${toolName} did not respond in time.`;
    case "invalid_url":
      return `${toolName} rejected the request arguments.`;
    default:
      return `${toolName} could not complete the operation. The integration may be temporarily unavailable.`;
  }
}
