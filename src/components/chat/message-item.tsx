"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/conversations/types";
import { cn, formatClockTime } from "@/lib/utils";
import { IconCheck, IconCopy } from "@/components/icons";
import { OstraAvatar } from "@/components/ostra-mark";

export function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <li
      className={cn("flex w-full animate-fade-up gap-3", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && <OstraAvatar className="mt-0.5" />}

      <div className={cn("flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col sm:max-w-[46rem]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "w-full whitespace-pre-wrap break-words rounded-2xl border px-4 py-3 text-[15px] leading-relaxed",
            isUser
              ? "rounded-br-md border-signal-400/25 bg-signal-500/[0.12] text-zinc-50"
              : "rounded-bl-md border-white/[0.06] bg-void-850/85 text-zinc-200",
            message.interrupted && "italic text-zinc-500",
          )}
        >
          {message.content}
        </div>

        <div className="mt-1.5 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          <span className={cn(isUser ? "text-zinc-500" : "text-signal-400/80")}>
            {isUser ? "You" : "Ostra"}
          </span>
          <span className="text-zinc-700">·</span>
          <time dateTime={new Date(message.createdAt).toISOString()}>{formatClockTime(message.createdAt)}</time>
          {!isUser && !message.interrupted && <CopyButton text={message.content} />}
        </div>
      </div>
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (insecure context) — silently ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Reply copied" : "Copy reply"}
      className="ml-auto rounded-md p-1 text-zinc-600 transition hover:text-zinc-300"
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
    </button>
  );
}
