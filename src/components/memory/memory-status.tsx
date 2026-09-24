"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { IconAlert, IconCheck, IconRefresh } from "@/components/icons";

interface MemoryIntegration {
  id: string;
  name: string;
  description: string;
  state: string;
  connected: boolean;
  authorized: boolean;
  executionReady: boolean;
  executionReason: string | null;
  note: string;
}

/**
 * Live memory-layer status: probes the Mem0 integration (GET
 * /api/integrations?probe=1&ids=mem0) and reports whether persistent memory
 * can execute right now. Honest states only — a connector that is merely
 * registered is never reported as connected.
 */
export function MemoryStatus() {
  const [integration, setIntegration] = useState<MemoryIntegration | null>(null);
  const [probing, setProbing] = useState(true);
  const [probeError, setProbeError] = useState(false);

  const probe = useCallback(async () => {
    setProbing(true);
    setProbeError(false);
    try {
      const response = await fetch("/api/integrations?probe=1&ids=mem0", { cache: "no-store" });
      if (!response.ok) throw new Error(`probe ${response.status}`);
      const payload = (await response.json()) as { integrations: MemoryIntegration[] };
      setIntegration(payload.integrations[0] ?? null);
    } catch {
      setProbeError(true);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const ready = integration?.executionReady === true;
  const reason = integration?.executionReason ?? integration?.note ?? null;

  return (
    <section className="ostra-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-200">Persistent memory (Mem0)</h2>
        <button
          type="button"
          onClick={() => void probe()}
          disabled={probing}
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-zinc-200 transition hover:bg-white/[0.06] disabled:opacity-50"
        >
          <IconRefresh size={13} /> {probing ? "Checking…" : "Recheck"}
        </button>
      </div>

      {probing && !integration && <p className="mt-3 text-[13px] text-zinc-500">Checking the Mem0 connection…</p>}

      {probeError && !probing && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ember-300">
          <IconAlert size={14} /> The memory status could not be loaded. Try again.
        </p>
      )}

      {integration && !probing && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "ostra-chip",
                ready ? "border-signal-400/30 text-signal-300" : "border-white/[0.08] text-zinc-400",
              )}
            >
              {ready ? (
                <>
                  <IconCheck size={11} /> ready
                </>
              ) : (
                "not execution-ready"
              )}
            </span>
            <span className="ostra-chip">mem0.search_memory · read</span>
            <span className="ostra-chip">mem0.save_memory · write · approval-gated</span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
            {ready
              ? "Mem0 is connected on this deployment. Ask Ostra to remember a fact (with memory saving enabled in the chat header) and it will be stored persistently; relevant memories are retrieved before answering."
              : reason}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-600">
            {ready
              ? null
              : "Memory executes through Vercel Connect or a server-side MEM0_API_KEY credential (e.g. synced by the Mem0 Marketplace integration). It becomes live once either is present on the deployment — nothing is simulated in the meantime."}
          </p>
        </>
      )}
    </section>
  );
}
