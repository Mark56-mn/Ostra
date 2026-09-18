"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CLIENT_MAX_MESSAGE_LENGTH, WARN_MESSAGE_LENGTH } from "@/lib/chat/constants";
import { cn } from "@/lib/utils";
import { IconSend, IconStop } from "@/components/icons";

export function Composer({
  onSend,
  onStop,
  isPending,
}: {
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
  isPending: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the content, then scroll internally past ~8 lines.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 208)}px`;
  }, [value]);

  const trimmed = value.trim();
  const tooLong = value.length > CLIENT_MAX_MESSAGE_LENGTH;
  const canSend = trimmed.length > 0 && !isPending && !tooLong;

  function submit() {
    if (!canSend) return;
    const text = trimmed;
    setValue("");
    void onSend(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-void-950/85 backdrop-blur safe-bottom">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-void-900/80 p-2 transition focus-within:border-signal-400/40 focus-within:shadow-signal-glow">
          <label htmlFor="ostra-input" className="sr-only">
            Message Ostra
          </label>
          <textarea
            id="ostra-input"
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            enterKeyHint="send"
            autoComplete="off"
            spellCheck
            placeholder="Message Ostra…"
            className="max-h-52 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          {isPending ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] active:scale-95"
            >
              <IconStop size={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition active:scale-95",
                canSend
                  ? "bg-signal-500 text-void-950 hover:bg-signal-400"
                  : "cursor-not-allowed border border-white/[0.06] bg-white/[0.02] text-zinc-600",
              )}
            >
              <IconSend size={17} />
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          <span className="truncate">Enter to send · Shift+Enter for a new line</span>
          <span
            className={cn(
              tooLong ? "text-red-300" : value.length > WARN_MESSAGE_LENGTH ? "text-ember-300" : "",
            )}
          >
            {value.length > WARN_MESSAGE_LENGTH ? `${value.length}/${CLIENT_MAX_MESSAGE_LENGTH}` : ""}
          </span>
        </div>
      </form>
    </div>
  );
}
