/**
 * Request validation.
 *
 * The API assumes nothing about what the browser sends. History arriving from
 * the client is treated as untrusted input: it is re-typed, length-capped and
 * role-filtered before it can reach the model, and it is never used for
 * anything privileged.
 */
import { getMaxMessageLength } from "@/lib/model/config";
import type { ModelMessage } from "@/lib/model";

export const MAX_HISTORY_MESSAGES = 24;
export const MAX_CONVERSATION_ID_LENGTH = 128;

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface ChatRequestPayload {
  message: string;
  conversationId: string;
  history: ModelMessage[];
}

export type ValidationResult =
  | { ok: true; value: ChatRequestPayload }
  | { ok: false; code: string; message: string };

export function createConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ostra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseChatRequest(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "invalid_body", message: "Request body must be a JSON object." };
  }

  const record = body as Record<string, unknown>;
  const maxLength = getMaxMessageLength();

  // --- message ---------------------------------------------------------------
  if (typeof record.message !== "string") {
    return { ok: false, code: "invalid_message", message: "`message` must be a string." };
  }
  const message = record.message.trim();
  if (message.length === 0) {
    return { ok: false, code: "empty_message", message: "`message` cannot be empty." };
  }
  if (message.length > maxLength) {
    return {
      ok: false,
      code: "message_too_long",
      message: `\`message\` must be ${maxLength} characters or fewer.`,
    };
  }

  // --- conversationId -------------------------------------------------------
  let conversationId: string;
  if (record.conversationId === undefined || record.conversationId === null || record.conversationId === "") {
    conversationId = createConversationId();
  } else if (typeof record.conversationId !== "string") {
    return { ok: false, code: "invalid_conversation_id", message: "`conversationId` must be a string." };
  } else {
    const candidate = record.conversationId.trim();
    if (candidate.length > MAX_CONVERSATION_ID_LENGTH || !CONVERSATION_ID_PATTERN.test(candidate)) {
      return {
        ok: false,
        code: "invalid_conversation_id",
        message: "`conversationId` must be 1-128 characters of letters, digits, `.`, `_`, `:` or `-`.",
      };
    }
    conversationId = candidate;
  }

  // --- history (optional, sanitised) ---------------------------------------
  const history = sanitizeHistory(record.history, maxLength);

  return { ok: true, value: { message, conversationId, history } };
}

/** Drops anything that does not look like a plain conversational turn. */
export function sanitizeHistory(value: unknown, maxLength: number): ModelMessage[] {
  if (!Array.isArray(value)) return [];

  const cleaned: ModelMessage[] = [];
  for (const entry of value.slice(-MAX_HISTORY_MESSAGES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    cleaned.push({ role, content: trimmed.slice(0, maxLength) });
  }
  return cleaned;
}
