"use client";

import type { SystemInfo } from "@/lib/system/info";
import { cn } from "@/lib/utils";

export type LinkState = "checking" | "unselected" | "live" | "unreachable";

/**
 * Ostra has no default model: "live" means the server has at least one usable
 * provider configured, never that a specific model is answering.
 */
export function linkState(systemInfo: SystemInfo | null, failed: boolean): LinkState {
  if (failed) return "unreachable";
  if (!systemInfo) return "checking";
  return systemInfo.mode === "unselected" ? "unselected" : "live";
}

const STATE_STYLES: Record<LinkState, { label: string; dot: string; text: string; ring: string }> = {
  checking: { label: "Linking", dot: "bg-zinc-500", text: "text-zinc-400", ring: "border-white/10" },
  unselected: { label: "No model selected", dot: "bg-ember-400", text: "text-ember-300", ring: "border-ember-400/30" },
  live: { label: "Model linked", dot: "bg-signal-400", text: "text-signal-300", ring: "border-signal-400/30" },
  unreachable: { label: "API unreachable", dot: "bg-red-400", text: "text-red-300", ring: "border-red-500/30" },
};

/**
 * Reflects what the server actually reports about the model link, so the UI
 * can never imply a live model when no provider is configured.
 */
export function SystemStatusChip({
  systemInfo,
  failed,
  className,
}: {
  systemInfo: SystemInfo | null;
  failed: boolean;
  className?: string;
}) {
  const state = linkState(systemInfo, failed);
  const style = STATE_STYLES[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-white/[0.02] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
        style.ring,
        style.text,
        className,
      )}
      title={systemInfo ? `no default model · ${systemInfo.providers?.length ?? 0} providers registered` : undefined}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-70", style.dot)} />
        {state === "live" && (
          <span className={cn("absolute inline-flex h-full w-full animate-pulse-ring rounded-full", style.dot)} />
        )}
      </span>
      {style.label}
    </span>
  );
}
