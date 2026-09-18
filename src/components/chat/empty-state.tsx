"use client";

import { OSTRA_CAPABILITIES, OSTRA_GREETING, OSTRA_SUGGESTIONS } from "@/lib/agent/persona";
import type { SystemInfo } from "@/lib/system/info";
import { cn } from "@/lib/utils";
import { OstraMark } from "@/components/ostra-mark";

/**
 * The landing view of the control center: Ostra's greeting, what is wired up
 * today, and a few prompts to get the conversation moving.
 */
export function EmptyState({
  systemInfo,
  onPick,
  disabled,
}: {
  systemInfo: SystemInfo | null;
  onPick: (prompt: string) => void;
  disabled: boolean;
}) {
  const isMock = !systemInfo || systemInfo.mode === "mock";

  return (
    <div className="flex animate-fade-up flex-col items-center gap-7 py-6 text-center sm:py-12">
      <span className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-signal-400/20 bg-signal-500/[0.07] text-signal-300">
        <span className="absolute inset-0 rounded-3xl bg-signal-500/[0.06] blur-xl" />
        <OstraMark size={44} animated />
      </span>

      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">Ostra / AI system</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[28px]">Talk to Ostra</h1>
        <p className="mx-auto max-w-md text-pretty-ostra text-sm leading-relaxed text-zinc-400">
          {OSTRA_GREETING}
        </p>
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {OSTRA_CAPABILITIES.map((capability) => (
          <li
            key={capability.label}
            className={cn(
              "rounded-full border px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.14em]",
              capability.status === "active"
                ? "border-signal-400/25 bg-signal-500/[0.07] text-signal-200"
                : "border-white/[0.07] bg-white/[0.02] text-zinc-500",
            )}
            title={capability.detail}
          >
            {capability.label}
            {capability.status === "planned" && <span className="ml-1.5 text-zinc-600">· planned</span>}
          </li>
        ))}
      </ul>

      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {OSTRA_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestion)}
            className="rounded-xl border border-white/[0.07] bg-void-900/70 px-3.5 py-3 text-left text-[13px] text-zinc-300 transition hover:border-signal-400/30 hover:bg-void-850 hover:text-zinc-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <p className="max-w-md text-[11px] leading-relaxed text-zinc-600">
        {systemInfo === null
          ? "Contacting the Ostra API…"
          : isMock
            ? `Replies are simulated by the built-in mock provider (${systemInfo.model}). Link a model endpoint to change that.`
            : `Connected to the model endpoint · ${systemInfo.model} (${systemInfo.provider}).`}
      </p>
    </div>
  );
}
