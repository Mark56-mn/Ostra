/**
 * Conversation domain types.
 *
 * These are the shapes a future database (Postgres/Supabase) will persist, so
 * they stay plain and serialisable — no class instances, no functions.
 */

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  /** Set when the user stopped generation mid-flight. */
  interrupted?: boolean;
  /** Ostra native tool ids that ran for this reply (transparency). */
  toolsUsed?: string[];
  /** Citation URLs from server-side web search/fetch, when any. */
  sources?: Array<{ url: string; title?: string }>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Storage seam. v0 ships a browser implementation; a server implementation
 * (database-backed) only needs to satisfy this same interface and be returned
 * from `createConversationRepository()`.
 */
export interface ConversationRepository {
  load(): Conversation[] | Promise<Conversation[]>;
  saveAll(conversations: Conversation[]): void | Promise<void>;
  clear(): void | Promise<void>;
}
