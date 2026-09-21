/**
 * Complete OpenAI-compatible response parser.
 *
 * Handles everything the previous text-only parser dropped:
 * - `choices[0].message.content` as string OR content-parts array
 *   (OpenRouter returns `[{ type: "text", text }, { type: "o1-style" }]`
 *   when server tools inject segments)
 * - `choices[0].message.tool_calls` — OpenAI-style function tool calls the
 *   model wants Ostra to execute (client tool-call loop)
 * - `choices[0].message.annotations` — OpenRouter url_citation annotations
 *   from server tools (web search/fetch)
 * - `finish_reason` — "tool_calls" means the loop must continue
 * - `usage.server_tool_use` — OpenRouter server-tool step accounting
 *
 * Tolerant by design: unknown shapes degrade to extracted text, never throw.
 * Secrets never appear here — the parser only ever sees provider responses.
 */

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ParsedCitation {
  url: string;
  title?: string;
}

export interface ParsedProviderResponse {
  /** Plain assistant text (content joined across parts). */
  content: string | null;
  /** Function tool calls requested by the model (may be empty). */
  toolCalls: ParsedToolCall[];
  /** Citations extracted from server-tool annotations. */
  citations: ParsedCitation[];
  /** finish_reason from the provider, when present. */
  finishReason: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    serverToolSteps?: number;
  };
}

export function parseOpenAIChatResponse(raw: string): ParsedProviderResponse {
  const trimmed = raw.trim();
  if (!trimmed) return emptyParsed();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Non-JSON payloads (some custom endpoints): treat the body as text.
    return { ...emptyParsed(), content: trimmed.slice(0, 20_000) || null };
  }

  const message = pick(parsed, ["choices", 0, "message"]) ?? pick(parsed, ["message"]);
  const finishReason = asString(pick(parsed, ["choices", 0, "finish_reason"]) ?? pick(parsed, ["finish_reason"]));

  const content = extractMessageContent(message, parsed);
  const toolCalls = extractToolCalls(message, parsed);
  const citations = extractCitations(message);
  const usage = extractUsage(parsed);

  return { content, toolCalls, citations, finishReason, usage };
}

function emptyParsed(): ParsedProviderResponse {
  return { content: null, toolCalls: [], citations: [], finishReason: null };
}

/**
 * Extract assistant text: plain string, content-parts array
 * (`[{ type: "text", text: "..." }]`), or legacy top-level text fields.
 */
function extractMessageContent(message: unknown, root: unknown): string | null {
  const fromMessage = coerceMessageText(message);
  if (fromMessage) return fromMessage;

  // Legacy / alternate shapes.
  for (const path of [
    ["choices", 0, "text"],
    ["response"],
    ["output"],
    ["outputs", 0],
    ["content"],
    ["text"],
    ["generated_text"],
    ["result"],
  ]) {
    const text = coerceText(pick(root, path));
    if (text) return text;
  }
  return null;
}

function coerceMessageText(message: unknown): string | null {
  if (typeof message === "string") return nonEmpty(message);
  if (!isObject(message)) return null;

  const record = message as Record<string, unknown>;
  if (typeof record.content === "string") return nonEmpty(record.content);

  // Content-parts array (OpenRouter server tools + reasoning models).
  if (Array.isArray(record.content)) {
    const parts: string[] = [];
    for (const part of record.content) {
      if (typeof part === "string") {
        const text = nonEmpty(part as string);
        if (text) parts.push(text);
        continue;
      }
      if (isObject(part)) {
        const p = part as Record<string, unknown>;
        const type = typeof p.type === "string" ? p.type : "";
        const text = nonEmpty(typeof p.text === "string" ? p.text : "");
        // Text-type parts carry the answer; other types (e.g. injected tool
        // segments) may carry text too — include only text-ish content so the
        // user never sees raw tool payloads.
        if (text && (type === "" || type === "text" || type === "output_text")) {
          parts.push(text);
        }
      }
    }
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  }

  return coerceText(record.content) ?? coerceText(record.text);
}

/** OpenAI tool_calls: `[{ id, type: "function", function: { name, arguments } }]`. */
function extractToolCalls(message: unknown, root: unknown): ParsedToolCall[] {
  const sources: unknown[] = [
    isObject(message) ? (message as Record<string, unknown>).tool_calls : undefined,
    pick(root, ["choices", 0, "delta", "tool_calls"]),
    pick(root, ["tool_calls"]),
  ];

  const calls: ParsedToolCall[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isObject(entry)) continue;
      const record = entry as Record<string, unknown>;
      const fn = isObject(record.function) ? (record.function as Record<string, unknown>) : null;
      const name = asString(fn?.name);
      if (!name) continue;
      calls.push({
        id: asString(record.id) ?? `call_${calls.length}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        arguments: typeof fn?.arguments === "string" ? fn.arguments : "{}",
      });
    }
    if (calls.length > 0) break; // first source that yields calls wins
  }
  return calls;
}

/** OpenRouter url_citation annotations: `{ type: "url_citation", url_citation: { url, title } }`. */
function extractCitations(message: unknown): ParsedCitation[] {
  if (!isObject(message)) return [];
  const annotations = (message as Record<string, unknown>).annotations;
  if (!Array.isArray(annotations)) return [];

  const citations: ParsedCitation[] = [];
  for (const annotation of annotations) {
    if (!isObject(annotation)) continue;
    const record = annotation as Record<string, unknown>;
    const inner = isObject(record.url_citation) ? (record.url_citation as Record<string, unknown>) : record;
    const url = asString(inner.url);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    citations.push({ url, title: asString(inner.title) ?? undefined });
  }
  return citations;
}

function extractUsage(parsed: unknown): ParsedProviderResponse["usage"] {
  const usage = pick(parsed, ["usage"]) ?? pick(parsed, ["token_usage"]);
  if (!isObject(usage)) return undefined;
  const record = usage as Record<string, unknown>;
  const asNum = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : undefined);

  let serverToolSteps: number | undefined;
  const serverToolUse = record.server_tool_use;
  if (isObject(serverToolUse)) {
    const st = serverToolUse as Record<string, unknown>;
    for (const key of ["web_search_requests", "web_fetch_requests", "image_generation_requests", "total_requests"]) {
      if (typeof st[key] === "number") {
        serverToolSteps = (serverToolSteps ?? 0) + (st[key] as number);
      }
    }
  }

  const result = {
    promptTokens: asNum("prompt_tokens") ?? asNum("input_tokens"),
    completionTokens: asNum("completion_tokens") ?? asNum("output_tokens"),
    totalTokens: asNum("total_tokens"),
    serverToolSteps,
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

// --- shared helpers ---------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nonEmpty(value: string): string | null {
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function coerceText(value: unknown): string | null {
  if (typeof value === "string") return nonEmpty(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(coerceText).filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (isObject(value)) {
    return coerceText(value.text) ?? coerceText(value.content) ?? coerceText(value.message);
  }
  return null;
}

function pick(value: unknown, path: Array<string | number>): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
      continue;
    }
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}
