"use client";

import { useEffect, useSyncExternalStore } from "react";
import { retryLastMessage, sendMessage, stopGeneration } from "@/lib/chat/controller";
import { chatStore, type ChatStoreState } from "@/lib/conversations/store";

export interface UseChatResult extends ChatStoreState {
  sendMessage: (text: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  stopGeneration: () => void;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  clearError: () => void;
}

/**
 * Reads conversation state from the shared store and wires it to the chat
 * controller. Safe to use from several components at once — they all observe
 * the same store instance.
 */
export function useChat(): UseChatResult {
  const state = useSyncExternalStore(chatStore.subscribe, chatStore.getState, chatStore.getServerState);

  useEffect(() => {
    void chatStore.hydrate();
  }, []);

  return {
    ...state,
    sendMessage,
    retryLastMessage,
    stopGeneration,
    newConversation: () => {
      chatStore.createConversation();
    },
    selectConversation: (id: string) => {
      chatStore.setActiveConversation(id);
    },
    deleteConversation: (id: string) => {
      chatStore.deleteConversation(id);
    },
    clearError: () => {
      chatStore.setError(null);
    },
  };
}
