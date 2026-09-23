"use client";

import Link from "next/link";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { useChat } from "@/hooks/use-chat";
import { cn, formatRelativeTime } from "@/lib/utils";
import { IconChat, IconClose, IconCpu, IconLayers, IconList, IconPlus, IconSettings, IconTrash } from "./icons";
import { OstraMark } from "./ostra-mark";
import { SystemStatusChip } from "./system-status";

export type NavId = "conversations" | "models" | "tasks" | "memory" | "settings";

interface NavItem {
  id: NavId;
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  soon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "conversations", label: "Conversations", href: "/", icon: IconChat },
  { id: "models", label: "Models", href: "/models", icon: IconCpu },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: IconList },
  { id: "memory", label: "Memory", href: "/memory", icon: IconLayers },
  { id: "settings", label: "Settings", href: "/settings", icon: IconSettings },
];

export function Sidebar({
  activeNav,
  open,
  onClose,
}: {
  activeNav: NavId;
  open: boolean;
  onClose: () => void;
}) {
  const chat = useChat();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const conversations = useMemo(
    () => [...chat.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [chat.conversations],
  );

  return (
    <aside
      id="ostra-sidebar"
      aria-label="Ostra navigation"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[20rem] flex-col border-r border-white/[0.06] bg-void-900/95 backdrop-blur-xl transition-transform duration-300 ease-out",
        "lg:sticky lg:top-0 lg:z-30 lg:h-[100dvh] lg:w-[19rem] lg:max-w-none lg:translate-x-0 lg:bg-void-900/50 lg:backdrop-blur-none",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-5">
        <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-signal-400/25 bg-signal-500/10 text-signal-300">
            <OstraMark size={22} animated />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-[0.3em] text-zinc-100">OSTRA</span>
            <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
              AI system · v0
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="rounded-xl border border-white/[0.08] p-2 text-zinc-400 transition hover:text-zinc-100 lg:hidden"
        >
          <IconClose size={16} />
        </button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => {
            chat.newConversation();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl border border-signal-400/30 bg-signal-500/10 px-3 py-2.5 text-sm font-medium text-signal-200 transition hover:bg-signal-500/20 active:scale-[0.99]"
        >
          <IconPlus size={16} />
          New conversation
        </button>
      </div>

      <nav className="mt-5 px-2" aria-label="Sections">
        <p className="ostra-label px-3 pb-2">Control</p>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.id === activeNav;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-white/[0.06] text-zinc-100"
                      : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200",
                  )}
                >
                  <item.icon
                    size={16}
                    className={cn("shrink-0", active ? "text-signal-300" : "text-zinc-500 group-hover:text-zinc-300")}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.soon && (
                    <span className="rounded-full border border-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
                      soon
                    </span>
                  )}
                  {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal-400" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col px-2">
        <div className="flex items-center justify-between px-3 pb-2">
          <p className="ostra-label">Conversations</p>
          <span className="font-mono text-[10px] text-zinc-600">{conversations.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {!chat.hydrated ? (
            <ul className="space-y-1 px-1" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li key={row} className="h-11 animate-pulse rounded-xl bg-white/[0.03]" />
              ))}
            </ul>
          ) : conversations.length === 0 ? (
            <p className="px-3 py-6 text-xs leading-relaxed text-zinc-500">
              No conversations yet. Start one above — it will be stored in this browser only.
            </p>
          ) : (
            <ul className="space-y-0.5 pb-3">
              {conversations.map((conversation) => {
                const active = conversation.id === chat.activeId;
                const pending = conversation.id === chat.pendingId;
                return (
                  <li key={conversation.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-xl pr-1 transition",
                        active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          chat.selectConversation(conversation.id);
                          onClose();
                        }}
                        className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left"
                      >
                        <span
                          className={cn(
                            "block truncate text-[13px]",
                            active ? "text-zinc-100" : "text-zinc-400",
                          )}
                        >
                          {conversation.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                          {pending ? (
                            <span className="text-signal-300">thinking…</span>
                          ) : (
                            <>
                              <span>{conversation.messages.length} msg</span>
                              <span className="text-zinc-700">·</span>
                              <span>{formatRelativeTime(conversation.updatedAt, now)}</span>
                            </>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => chat.deleteConversation(conversation.id)}
                        aria-label={`Delete conversation: ${conversation.title}`}
                        className="rounded-lg p-2 text-zinc-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-60"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.06] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <SystemStatusChip systemInfo={chat.systemInfo} failed={chat.systemStatusFailed} />
          <span className="truncate font-mono text-[10px] text-zinc-600" title={chat.systemInfo?.model}>
            {chat.systemInfo?.model ?? "—"}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-zinc-600">
          Tools run through Ostra&apos;s pipeline; memory and GitHub are live on the deployment with their connectors.
        </p>
      </div>
    </aside>
  );
}
