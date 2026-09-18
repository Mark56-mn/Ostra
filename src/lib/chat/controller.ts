/**
 * Chat controller.
 *
 * Owns the request lifecycle between the UI and Ostra's own API: optimistic
 * user message → /api/chat → assistant message, with cancel and retry.
 *
 * The browser only ever calls Ostra's API. The model endpoint and its
 * credentials are reached server-side by the agent runtime.
 */
import { chatStore } from "@/lib/conversations/store";
import type { ChatMessage, Conversation } from "@/lib/conversations/types";
import type { ModelMessage } from "@/lib/model/types";
import { createId, isAbortError } from "@/lib/utils";
import { CLIENT_HISTORY_LIMIT, CLIENT_MAX_MESSAGE_LENGTH } from "./constants";

let activeRequest: AbortController | null = null;

interface ChatApiPayload {
  message?: unknown;
  conversationId?: unknown;
  model?: unknown;
  provider?: unknown;
  mode?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export async function sendMessage(rawText: string): Promise<void> {
  const text = rawText.trim();
  if (text.length === 0) return;

  const { pendingId } = chatStore.getState();
  if (pendingId) return; // one turn in flight at a time

  if (text.length > CLIENT_MAX_MESSAGE_LENGTH) {
    chatStore.setError(`That message is ${text.length} characters. Ostra accepts up to ${CLIENT_MAX_MESSAGE_LENGTH}.`);
    return;
  }

  const conversation = chatStore.ensureActiveConversation();
  const userMessage: ChatMessage = { id: createId(), role: "user", content: text, createdAt: Date.now() };

  chatStore.appendMessage(conversation.id, userMessage);
  chatStore.setError(null);
  chatStore.setPending(conversation.id);

  const controller = new AbortController();
  activeRequest = controller;

  try {
    const history = buildHistory(conversation.id, userMessage.id);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, conversationId: conversation.id, history }),
      signal: controller.signal,
    });

    const payload = await readJson(response);

    if (!response.ok) {
      throw new ChatRequestError(errorMessageFrom(payload, response.status));
    }

    const reply = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (!reply) {
      throw new ChatRequestError("Ostra returned an empty response.");
    }

    chatStore.appendMessage(conversation.id, {
      id: createId(),
      role: "assistant",
      content: reply,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (isAbortError(error)) {
      chatStore.appendMessage(conversation.id, {
        id: createId(),
        role: "assistant",
        content: "Generation stopped.",
        createdAt: Date.now(),
        interrupted: true,
      });
    } else {
      chatStore.setError(
        error instanceof ChatRequestError
          ? error.message
          : "Ostra could not be reached. Check the connection and try again.",
      );
    }
  } finally {
    activeRequest = null;
    chatStore.setPending(null);
  }
}

/** Re-sends the last user message after a failure. */
export async function retryLastMessage(): Promise<void> {
  const conversation = chatStore.getActiveConversation();
  if (!conversation) return;

  const lastUser = [...conversation.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return;

  chatStore.removeMessage(conversation.id, lastUser.id);
  chatStore.setError(null);
  await sendMessage(lastUser.content);
}

export function stopGeneration(): void {
  activeRequest?.abort();
  activeRequest = null;
}

export function isGenerating(): boolean {
  return activeRequest !== null;
}

/** Recent turns forwarded to the server; excludes the message being sent. */
function buildHistory(conversationId: string, excludeMessageId: string): ModelMessage[] {
  const conversation = chatStore.getConversation(conversationId);
  if (!conversation) return [];

  return toModelHistory(conversation, excludeMessageId);
}

export function toModelHistory(conversation: Conversation, excludeMessageId?: string): ModelMessage[] {
  const history: ModelMessage[] = [];
  for (const message of conversation.messages) {
    if (message.id === excludeMessageId) continue;
    if (message.interrupted) continue;
    const content = message.content.trim();
    if (!content) continue;
    history.push({ role: message.role, content });
  }
  return history.slice(-CLIENT_HISTORY_LIMIT);
}

async function readJson(response: Response): Promise<ChatApiPayload | null> {
  try {
    return (await response.json()) as ChatApiPayload;
  } catch {
    return null;
  }
}

function errorMessageFrom(payload: ChatApiPayload | null, status: number): string {
  const message = payload?.error?.message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  if (status === 429) return "Ostra is receiving too many requests. Wait a moment and try again.";
  if (status === 503) return "The model endpoint is unavailable right now.";
  return `Ostra's API returned an error (HTTP ${status}).`;
}

class ChatRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRequestError";
  }
}
