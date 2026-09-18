"use client";

import { useCallback, useEffect, useRef } from "react";
import { IconAlert, IconClose, IconRefresh } from "@/components/icons";
import { OstraAvatar } from "@/components/ostra-mark";
import { SystemStatusChip } from "@/components/system-status";
import { useChat } from "@/hooks/use-chat";
import { Composer } from "./composer";
import { EmptyState } from "./empty-state";
import { MessageItem } from "./message-item";
import { ThinkingIndicator } from "./thinking-indicator";

export function ChatWorkspace() {
  const chat = useChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const active = chat.conversations.find((conversation) => conversation.id === chat.activeId) ?? null;
  const messages = active?.messages ?? [];
  const isPending = chat.pendingId !== null && chat.pendingId === chat.activeId;

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  // Switching conversations: jump straight to the newest message.
  useEffect(() => {
    stickToBottomRef.current = true;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.activeId]);

  // New content: follow along only if the reader is already at the bottom.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom(messages.length > 1 ? "smooth" : "auto");
  }, [messages.length, isPending, scrollToBottom]);

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 140;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-white/[0.06] bg-void-950/60 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <OstraAvatar className="hidden sm:flex" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">
              {active?.title ?? "New conversation"}
            </p>
            <p className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              <span className="text-signal-300">Ostra</span>
              <span className="text-zinc-700">/</span>
              <span>AI system</span>
              <span className="text-zinc-700">·</span>
              <span>{messages.length} msg</span>
            </p>
          </div>
          <SystemStatusChip
            systemInfo={chat.systemInfo}
            failed={chat.systemStatusFailed}
            className="hidden shrink-0 sm:inline-flex"
          />
        </div>
      </header>

      <div className="shrink-0 border-b border-white/[0.04] bg-ember-500/[0.05] px-4 py-2 sm:px-6">
        <p className="mx-auto max-w-3xl text-[11px] leading-snug text-ember-300/80">
          <span className="font-mono uppercase tracking-[0.16em] text-ember-300">Prototype v0.1.0</span>
          <span className="mx-2 text-ember-500/40">|</span>
          Conversation layer only — tools, persistent memory and scheduling are not wired up yet.
        </p>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {messages.length === 0 && !isPending ? (
            <EmptyState
              systemInfo={chat.systemInfo}
              onPick={(prompt) => void chat.sendMessage(prompt)}
              disabled={isPending}
            />
          ) : (
            <ul className="flex flex-col gap-5">
              {messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
              {isPending && <ThinkingIndicator />}
            </ul>
          )}
        </div>
      </div>

      {chat.error && (
        <div className="shrink-0 px-3 sm:px-6">
          <div
            role="alert"
            className="mx-auto flex w-full max-w-3xl animate-fade-up items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3.5 py-3 text-[13px] leading-relaxed text-red-200"
          >
            <IconAlert size={16} className="mt-0.5 shrink-0 text-red-300" />
            <p className="min-w-0 flex-1">{chat.error}</p>
            <button
              type="button"
              onClick={() => void chat.retryLastMessage()}
              disabled={isPending}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-400/30 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
            >
              <IconRefresh size={12} />
              Retry
            </button>
            <button
              type="button"
              onClick={chat.clearError}
              aria-label="Dismiss error"
              className="shrink-0 rounded-lg p-1.5 text-red-300/70 transition hover:text-red-100"
            >
              <IconClose size={14} />
            </button>
          </div>
        </div>
      )}

      <Composer onSend={chat.sendMessage} onStop={chat.stopGeneration} isPending={isPending} />
    </div>
  );
}
