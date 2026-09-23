/**
 * Chat tool auto-attach (Stage 1–3 of tool calling).
 *
 * Decides which tools the model may see for the effective provider/model,
 * independent of what the client explicitly requested:
 *
 * - Every tool-calling model gets the Ostra-executed **native** tools
 *   (datetime, web fetch) as OpenAI-style functions — Ostra executes them
 *   server-side through the permission pipeline.
 * - **OpenRouter** models additionally get the OpenRouter **server** tools
 *   (web search, web fetch) attached as server-tool specs; OpenRouter
 *   executes those itself and Ostra parses citations/step counts.
 * - Providers that are not verified for `toolCalling` get no tools at all —
 *   the capability registry is the single source of truth and "unknown"
 *   never pretends to be supported.
 */
import { getModelCapabilities } from "@/lib/providers/capabilities";
import type { FunctionToolAttachment } from "@/lib/model/types";
import { getToolDefinition } from "./registry";
import type { ToolDefinition } from "./types";
import { toolConfigStore } from "./config";

/** Native tools the model may call (executed by Ostra, permission-gated). */
const NATIVE_TOOL_IDS = ["ostra:datetime", "ostra:web_fetch"] as const;

/** OpenRouter server tools attached for OpenRouter models. */
const OPENROUTER_SERVER_TOOL_IDS = ["openrouter:web_search", "openrouter:web_fetch"] as const;

export interface ResolvedToolAttachment {
  /** OpenAI-style function tools the model may call; Ostra executes. */
  functionTools: FunctionToolAttachment[];
  /** OpenRouter server-tool specs attached to the request (OpenRouter only). */
  serverTools: Array<{ type: string; parameters?: Record<string, unknown> }>;
}

/** All tools attached for this effective provider/model (may be empty). */
export function resolveAutoTools(providerId: string, modelId: string): ResolvedToolAttachment {
  const empty: ResolvedToolAttachment = { functionTools: [], serverTools: [] };
  const caps = getModelCapabilities(providerId, resolveCapabilityModelId(providerId, modelId));
  if (!caps || caps.capabilities.toolCalling !== true) return empty; // unknown/absent → no tools, no guessing

  // Native tools: every tool-calling model gets these.
  const functionTools: FunctionToolAttachment[] = [];
  for (const id of NATIVE_TOOL_IDS) {
    const tool = getToolDefinition(id);
    if (!tool || !toolConfigStore.isEnabled(tool)) continue;
    functionTools.push(toFunctionAttachment(tool));
  }

  // OpenRouter server tools: OpenRouter models only.
  const serverTools: Array<{ type: string; parameters?: Record<string, unknown> }> = [];
  if (providerId === "openrouter") {
    for (const id of OPENROUTER_SERVER_TOOL_IDS) {
      const tool = getToolDefinition(id);
      if (!tool || !toolConfigStore.isEnabled(tool)) continue;
      serverTools.push({ type: id });
    }
  }

  return { functionTools, serverTools };
}

/**
 * Map the effective model id to its capability entry. A capability entry
 * (which is allowlist-wide) covers catalog variants of the same model, so an
 * env-default model like `AI_MODEL` still resolves. Falls back to the raw id.
 */
function resolveCapabilityModelId(providerId: string, modelId: string): string {
  if (getModelCapabilities(providerId, modelId)) return modelId;
  for (const entry of getAllModelCapabilities()) {
    if (entry.providerId === providerId && sameModelFamily(entry.modelId, modelId)) return entry.modelId;
  }
  return modelId;
}

function sameModelFamily(a: string, b: string): boolean {
  if (a === b) return true;
  return normalize(a) === normalize(b);
}

function normalize(id: string): string {
  return id.toLowerCase().replace(/:free$/, "");
}

import { getAllModelCapabilities } from "@/lib/providers/capabilities";

function toFunctionAttachment(tool: ToolDefinition): FunctionToolAttachment {
  return {
    name: tool.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
    description: tool.description,
    parameters: sanitizeParameters(tool.inputSchema),
    toolId: tool.id,
  };
}

function sanitizeParameters(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return { type: "object", properties: {} };
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { type: "object" };
  if (s.properties && typeof s.properties === "object") out.properties = s.properties;
  if (Array.isArray(s.required)) out.required = s.required;
  return out;
}
