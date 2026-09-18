/**
 * Browser-local conversation storage.
 *
 * v0 keeps conversations in this browser only — no database, no server state.
 * Note: only conversation content lives here. Model credentials and every
 * other secret stay in server environment variables and are never written to
 * storage (or to any other client-visible place).
 */
import type { ChatMessage, Conversation, ConversationRepository } from "./types";

export const STORAGE_KEY = "ostra.conversations.v1";

const MAX_STORED_CONVERSATIONS = 200;
const MAX_STORED_MESSAGES = 400;
const MAX_STORED_CONTENT = 32_000;

export class LocalStorageConversationRepository implements ConversationRepository {
  private readonly key: string;

  constructor(key: string = STORAGE_KEY) {
    this.key = key;
  }

  load(): Conversation[] {
    if (!this.isAvailable()) return [];
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return [];
      return sanitizeStoredConversations(JSON.parse(raw));
    } catch (error) {
      // Corrupt or unreadable payload: start clean rather than crash the UI.
      console.warn("[ostra:storage] could not read conversations", error);
      return [];
    }
  }

  saveAll(conversations: Conversation[]): void {
    if (!this.isAvailable()) return;
    try {
      window.localStorage.setItem(this.key, JSON.stringify(conversations.slice(0, MAX_STORED_CONVERSATIONS)));
    } catch (error) {
      // Quota exceeded / private mode — conversation stays in memory.
      console.warn("[ostra:storage] could not persist conversations", error);
    }
  }

  clear(): void {
    if (!this.isAvailable()) return;
    try {
      window.localStorage.removeItem(this.key);
    } catch (error) {
      console.warn("[ostra:storage] could not clear conversations", error);
    }
  }

  private isAvailable(): boolean {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  }
}

/** Used during SSR and as the fallback when storage is blocked. */
export class MemoryConversationRepository implements ConversationRepository {
  private conversations: Conversation[] = [];

  load(): Conversation[] {
    return this.conversations;
  }

  saveAll(conversations: Conversation[]): void {
    this.conversations = conversations.slice(0, MAX_STORED_CONVERSATIONS);
  }

  clear(): void {
    this.conversations = [];
  }
}

export function createConversationRepository(): ConversationRepository {
  if (typeof window === "undefined") return new MemoryConversationRepository();
  return new LocalStorageConversationRepository();
}

/** Defensive parse — stored data is untrusted input as well. */
export function sanitizeStoredConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];

  const conversations: Conversation[] = [];
  for (const entry of value) {
    const conversation = sanitizeStoredConversation(entry);
    if (conversation) conversations.push(conversation);
    if (conversations.length >= MAX_STORED_CONVERSATIONS) break;
  }
  return conversations;
}

function sanitizeStoredConversation(value: unknown): Conversation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const id = typeof record.id === "string" && record.id.length > 0 && record.id.length <= 128 ? record.id : null;
  if (!id) return null;

  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;

  const messages: ChatMessage[] = [];
  if (Array.isArray(record.messages)) {
    for (const message of record.messages.slice(-MAX_STORED_MESSAGES)) {
      const cleaned = sanitizeStoredMessage(message);
      if (cleaned) messages.push(cleaned);
    }
  }

  const title =
    typeof record.title === "string" && record.title.trim().length > 0
      ? record.title.trim().slice(0, 120)
      : "Untitled conversation";

  return { id, title, messages, createdAt, updatedAt };
}

function sanitizeStoredMessage(value: unknown): ChatMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
  const content = typeof record.content === "string" ? record.content.slice(0, MAX_STORED_CONTENT) : null;
  if (!role || !content || content.length === 0) return null;

  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : `${role}_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();

  return { id, role, content, createdAt, ...(record.interrupted === true ? { interrupted: true } : {}) };
}
