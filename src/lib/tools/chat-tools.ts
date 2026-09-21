/**
 * Chat-request tool resolution (Stage 2).
 *
 * Turns the optional `tools` array on POST /api/chat into validated OpenRouter
 * server-tool attachments — or a structured refusal. Rules:
 *
 * - Only registry-listed tool IDs are accepted.
 * - Only OpenRouter server tools are model-attachable in Stage 2; native and
 *   Vercel Connect tools execute through their own adapters, not the model.
 * - OpenRouter server tools require the effective provider to be OpenRouter
 *   (or mock, where attachments are acknowledged but simulated).
 * - Model/tool compatibility is enforced against verified capabilities.
 * - Disabled tools and unapproved high-risk tools are refused.
 */
import { checkModelToolCompatibility } from "@/lib/tools/compatibility";
import { toolConfigStore } from "@/lib/tools/config";
import { getToolDefinition } from "@/lib/tools/registry";
import { validateToolArgs } from "@/lib/tools/validate-args";

export type ChatToolErrorCode =
  | "invalid_format"
  | "unknown_tool"
  | "tool_disabled"
  | "tool_not_attachable"
  | "provider_mismatch"
  | "incompatible_model"
  | "requires_approval"
  | "invalid_schema"
  | "invalid_args";

export interface ChatToolAttachment {
  tools: Array<{ type: string; parameters?: Record<string, unknown> }>;
  maxToolCalls: number;
}

export class ChatToolError extends Error {
  readonly code: ChatToolErrorCode;
  readonly status: number;

  constructor(code: ChatToolErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ChatToolError";
    this.code = code;
    this.status = status;
  }
}

const MAX_CHAT_TOOLS = 10;
const DEFAULT_MAX_TOOL_CALLS = 5;

/**
 * Resolve the optional `tools` field into gateway attachments.
 * `effective` is the provider/model the request will actually use after the
 * model-selection override is applied (falls back to the env default).
 */
export function resolveChatTools(
  raw: unknown,
  effective: { providerId: string; modelId: string },
): ChatToolAttachment | null {
  if (raw === undefined || raw === null) return null;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ChatToolError("invalid_format", "`tools` must be a non-empty array of tool IDs or { id, args } objects.");
  }
  if (raw.length > MAX_CHAT_TOOLS) {
    throw new ChatToolError("invalid_format", `At most ${MAX_CHAT_TOOLS} tools can be attached per message.`);
  }

  const attachments: Array<{ type: string; parameters?: Record<string, unknown> }> = [];
  const maxToolCalls = DEFAULT_MAX_TOOL_CALLS;

  for (const entry of raw) {
    const { toolId, args } = parseToolEntry(entry);
    const tool = getToolDefinition(toolId);
    if (!tool) {
      throw new ChatToolError("unknown_tool", "That tool is not in Ostra's registry.", 404);
    }

    const enabled = toolConfigStore.isEnabled(tool);
    if (!enabled) {
      throw new ChatToolError("tool_disabled", "That tool is disabled in the Ostra registry.", 409);
    }

    if (tool.executionType !== "openrouter") {
      throw new ChatToolError(
        "tool_not_attachable",
        "Only OpenRouter server tools attach to model requests; other tools run through /api/tools/execute.",
        409,
      );
    }

    if (effective.providerId !== "openrouter" && effective.providerId !== "mock") {
      throw new ChatToolError(
        "provider_mismatch",
        "OpenRouter server tools require the OpenRouter provider.",
        409,
      );
    }

    if (effective.providerId === "mock") {
      // Mock mode acknowledges attachments; nothing is executed anywhere.
      attachments.push({ type: tool.id, parameters: sanitizeParameters(tool.inputSchema) });
      continue;
    }

    const compatibility = checkModelToolCompatibility({
      providerId: effective.providerId,
      modelId: effective.modelId,
      tool,
    });
    if (!compatibility.compatible) {
      throw new ChatToolError(
        compatibility.code === "capability_unknown" || compatibility.code === "capability_missing" || compatibility.code === "unknown_model"
          ? "incompatible_model"
          : mapCompatCode(compatibility.code),
        compatibility.message,
        409,
      );
    }

    // Approval policy: disabled tools were refused above; enabled tools with
    // requiresApproval must carry explicit confirmation via the request.
    if (toolConfigStore.requiresApproval(tool)) {
      throw new ChatToolError(
        "requires_approval",
        "That tool requires explicit confirmation before it can be attached.",
        403,
      );
    }

    const validation = validateToolArgs(tool.id, tool.inputSchema, args);
    if (!validation.ok) {
      throw new ChatToolError(validation.code === "invalid_schema" ? "invalid_schema" : "invalid_args", validation.message, 400);
    }

    attachments.push({
      type: tool.id,
      parameters: sanitizeParameters(tool.inputSchema),
    });
  }

  return attachments.length > 0 ? { tools: attachments, maxToolCalls } : null;
}

function parseToolEntry(entry: unknown): { toolId: string; args: Record<string, unknown> } {
  if (typeof entry === "string") {
    return { toolId: entry, args: {} };
  }
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") {
      throw new ChatToolError("invalid_format", "Tool entries must be IDs or { id, args } objects.");
    }
    return { toolId: record.id, args: (record.args ?? {}) as Record<string, unknown> };
  }
  throw new ChatToolError("invalid_format", "Tool entries must be IDs or { id, args } objects.");
}

function mapCompatCode(code: string): ChatToolErrorCode {
  switch (code) {
    case "tool_disabled":
      return "tool_disabled";
    case "not_connected":
      return "tool_not_attachable";
    default:
      return "incompatible_model";
  }
}

function sanitizeParameters(schema: unknown): Record<string, unknown> | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (s.properties && typeof s.properties === "object") out.properties = s.properties;
  if (Array.isArray(s.required)) out.required = s.required;
  return Object.keys(out).length > 0 ? out : undefined;
}
