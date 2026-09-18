/**
 * Conversation store.
 *
 * A tiny framework-free external store (consumed with `useSyncExternalStore`)
 * so the sidebar, chat view and any future panel share one source of truth.
 * React state is intentionally not used for conversation data: this keeps the
 * storage seam in one place and makes a server-backed repository a drop-in.
 */
import type { SystemInfo } from "@/lib/system/info";
import { createId, truncate } from "@/lib/utils";
import { STORAGE_KEY, createConversationRepository } from "./local-repository";
import type { ChatMessage, Conversation, ConversationRepository } from "./types";

export interface ChatStoreState {
  hydrated: boolean;
  conversations: Conversation[];
  activeId: string | null;
  /** Conversation with a model request in flight. */
  pendingId: string | null;
  error: string | null;
  systemInfo: SystemInfo | null;
  systemStatusFailed: boolean;
}

const EMPTY_STATE: ChatStoreState = Object.freeze({
  hydrated: false,
  conversations: [] as Conversation[],
  activeId: null,
  pendingId: null,
  error: null,
  systemInfo: null,
  systemStatusFailed: false,
});

let state: ChatStoreState = { ...EMPTY_STATE };
const listeners = new Set<() => void>();

let repository: ConversationRepository | null = null;
let hydrating: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let crossTabAttached = false;

function getRepository(): ConversationRepository {
  if (!repository) repository = createConversationRepository();
  return repository;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<ChatStoreState>): void {
  state = { ...state, ...patch };
  emit();
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void getRepository().saveAll(state.conversations);
  }, 200);
}

function sortByRecency(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

function replaceConversation(updated: Conversation): Conversation[] {
  return state.conversations.map((conversation) => (conversation.id === updated.id ? updated : conversation));
}

export const chatStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Stable snapshot: a new object only when something actually changed. */
  getState(): ChatStoreState {
    return state;
  },

  getServerState(): ChatStoreState {
    return EMPTY_STATE;
  },

  /** Loads persisted conversations once, then keeps system status fresh. */
  async hydrate(): Promise<void> {
    if (state.hydrated) return;
    if (hydrating) return hydrating;

    hydrating = (async () => {
      try {
        const stored = await getRepository().load();
        const conversations = sortByRecency(stored);
        setState({
          conversations,
          activeId: conversations[0]?.id ?? null,
          hydrated: true,
        });
      } catch (error) {
        console.warn("[ostra:store] could not hydrate conversations", error);
        setState({ hydrated: true });
      }
      attachCrossTabSync();
      void refreshSystemInfo();
    })();

    return hydrating;
  },

  refreshSystemInfo,

  createConversation(): Conversation {
    const now = Date.now();
    const conversation: Conversation = {
      id: createId(),
      title: "New conversation",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setState({
      conversations: [conversation, ...state.conversations],
      activeId: conversation.id,
      error: null,
    });
    schedulePersist();
    return conversation;
  },

  getConversation(id: string): Conversation | null {
    return state.conversations.find((conversation) => conversation.id === id) ?? null;
  },

  getActiveConversation(): Conversation | null {
    if (!state.activeId) return null;
    return chatStore.getConversation(state.activeId);
  },

  /** Returns the active conversation, creating one when nothing is selected. */
  ensureActiveConversation(): Conversation {
    const existing = chatStore.getActiveConversation();
    if (existing) return existing;
    return chatStore.createConversation();
  },

  setActiveConversation(id: string | null): void {
    setState({ activeId: id });
  },

  deleteConversation(id: string): void {
    const conversations = state.conversations.filter((conversation) => conversation.id !== id);
    const activeId = state.activeId === id ? (sortByRecency(conversations)[0]?.id ?? null) : state.activeId;
    setState({
      conversations,
      activeId,
      pendingId: state.pendingId === id ? null : state.pendingId,
    });
    schedulePersist();
  },

  renameConversation(id: string, title: string): void {
    const conversation = chatStore.getConversation(id);
    if (!conversation) return;
    const clean = title.trim().slice(0, 120);
    if (!clean) return;
    setState({
      conversations: replaceConversation({ ...conversation, title: clean, updatedAt: Date.now() }),
    });
    schedulePersist();
  },

  clearAllConversations(): void {
    setState({ conversations: [], activeId: null, pendingId: null, error: null });
    void getRepository().clear();
  },

  appendMessage(conversationId: string, message: ChatMessage): void {
    const conversation = chatStore.getConversation(conversationId);
    if (!conversation) return;

    const isFirstUserMessage = message.role === "user" && !conversation.messages.some((entry) => entry.role === "user");

    setState({
      conversations: replaceConversation({
        ...conversation,
        title: isFirstUserMessage ? truncate(message.content, 48) || conversation.title : conversation.title,
        messages: [...conversation.messages, message],
        updatedAt: message.createdAt,
      }),
    });
    schedulePersist();
  },

  removeMessage(conversationId: string, messageId: string): void {
    const conversation = chatStore.getConversation(conversationId);
    if (!conversation) return;
    setState({
      conversations: replaceConversation({
        ...conversation,
        messages: conversation.messages.filter((message) => message.id !== messageId),
        updatedAt: Date.now(),
      }),
    });
    schedulePersist();
  },

  setPending(pendingId: string | null): void {
    setState({ pendingId });
  },

  setError(error: string | null): void {
    setState({ error });
  },
};

async function refreshSystemInfo(): Promise<void> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`health ${response.status}`);
    const payload = (await response.json()) as SystemInfo;
    setState({ systemInfo: payload, systemStatusFailed: false });
  } catch {
    setState({ systemStatusFailed: true });
  }
}

/** Keeps multiple Ostra tabs in sync. */
function attachCrossTabSync(): void {
  if (crossTabAttached || typeof window === "undefined") return;
  crossTabAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const stored = getRepository().load();
    if (typeof (stored as Promise<Conversation[]>).then === "function") return;
    setState({ conversations: sortByRecency(stored as Conversation[]) });
  });
}
