"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface IntegrationStatusEntry {
  id: string;
  name: string;
  executionReady: boolean;
}

/**
 * Minimal integration status chips (Stage 9) — "GitHub — Ready" style
 * indicators for the two V1 integrations. Nothing else about the UI changes.
 * Unavailable integrations render dimmed with an honest "—" instead of a
 * ready state.
 */
export function IntegrationChips({ className }: { className?: string }) {
  const [integrations, setIntegrations] = useState<IntegrationStatusEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/integrations?ids=github,mem0", { cache: "no-store" });
        if (!response.ok) throw new Error(`integrations ${response.status}`);
        const payload = (await response.json()) as { integrations?: IntegrationStatusEntry[] };
        if (!cancelled) setIntegrations(payload.integrations ?? []);
      } catch {
        if (!cancelled) setIntegrations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (integrations === null || integrations.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {integrations.map((integration) => (
        <span
          key={integration.id}
          title={integration.executionReady ? `${integration.name} is ready` : `${integration.name} is not execution-ready`}
          className={cn(
            "hidden items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] lg:inline-flex",
            integration.executionReady
              ? "border-signal-400/25 bg-signal-500/[0.06] text-signal-300/90"
              : "border-white/[0.06] bg-white/[0.01] text-zinc-600",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", integration.executionReady ? "bg-signal-400" : "bg-zinc-700")} />
          {integration.name}
        </span>
      ))}
    </div>
  );
}
