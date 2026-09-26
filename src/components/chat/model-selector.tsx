"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getModelPreference, useModelPreference, useMemoryWriteApproval } from "@/lib/chat/model-preference";
import { cn } from "@/lib/utils";
import { IconAlert, IconLayers } from "@/components/icons";

interface CatalogModel {
  id: string;
  name: string;
  free: boolean;
}

interface CatalogProvider {
  id: string;
  name: string;
  keyEnvVar: string;
  keyPresent: boolean;
  models: CatalogModel[];
}

interface ModelsPayload {
  providers: CatalogProvider[];
  active: { mode: string; provider: string; model: string; keyPresent: boolean; selectableProviders: string[] };
  /** The deliberate workspace default, or null when none is set. */
  defaultSelection: { provider: string; model: string } | null;
  /** Deliberate server-side workspace default from "Use as default" (null = no deliberate default). */
  workspaceDefault?: { provider: string; model: string; role?: string } | null;
}

/**
 * Compact model selector for the chat header.
 *
 * Lists the server-controlled allowlisted catalog (GET /api/models). The picked
 * value is persisted client-side and attached to every /api/chat request; the
 * server re-validates it each time. Selecting "Server default" clears the
 * override. Providers without a configured key are listed but locked.
 */
export function ModelSelector({ className }: { className?: string }) {
  const { preference, setPreference } = useModelPreference();
  const { approved: memoryApproved, setApproved: setMemoryApproved } = useMemoryWriteApproval();
  const [data, setData] = useState<ModelsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        if (!response.ok) throw new Error(`models ${response.status}`);
        const payload = (await response.json()) as ModelsPayload;
        if (!cancelled) {
          setData(payload);
          setLoadFailed(false);
          // The server's deliberate workspace default ("Use as default" in the
          // Model Control Center) is the authority when the user has not picked
          // a model in this browser. This keeps both controls in sync instead
          // of each holding a hidden, conflicting selection.
          if (payload.workspaceDefault) {
            const local = getModelPreference();
            if (!local) {
              setPreference({ provider: payload.workspaceDefault.provider, model: payload.workspaceDefault.model });
            }
          }
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setPreference]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Exclude providers with no allowlisted models (e.g. bare "mock" row is not in the catalog).
  const providers = useMemo(() => (data?.providers ?? []).filter((p) => p.models.length > 0), [data]);
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === preference?.provider) ?? null,
    [providers, preference],
  );
  const selectedModel = selectedProvider?.models.find((m) => m.id === preference?.model) ?? null;

  const isDefault = !preference;
  // A preference persisted from an earlier session can point at a provider
  // whose key has since been removed. Say so rather than letting the user
  // send into a guaranteed 409 key_missing.
  const selectionLocked = Boolean(selectedProvider && !selectedProvider.keyPresent);
  const label = isDefault
    ? "Default"
    : selectionLocked
      ? `${selectedProvider?.name ?? preference.provider} · no key`
      : selectedModel && selectedProvider
        ? selectedModel.name
        : preference.model;

  const pick = (provider: CatalogProvider, model: CatalogModel) => {
    // A provider with no credential cannot answer: the server rejects it
    // with 409 key_missing. Refuse here instead of letting the user select a
    // locked model and fail on send.
    if (!provider.keyPresent) return;
    setPreference({ provider: provider.id, model: model.id });
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select model"
        className="inline-flex min-h-[30px] max-w-[15rem] items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 transition hover:border-white/[0.14] hover:text-zinc-200"
      >
        <IconLayers size={12} className={cn("shrink-0", selectionLocked ? "text-ember-300" : preference ? "text-signal-300" : "text-zinc-600")} />
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Model catalog"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/[0.08] bg-void-900 shadow-2xl shadow-black/60"
        >
          <div className="max-h-80 overflow-y-auto p-1.5">
            {/* Server default */}
            <button
              type="button"
              onClick={() => {
                setPreference(null);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] transition",
                isDefault ? "bg-signal-500/10 text-signal-200" : "text-zinc-300 hover:bg-white/[0.04]",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {data?.workspaceDefault ? "Workspace default" : "No model selected"}
                </span>
                <span className="block truncate font-mono text-[10px] text-zinc-500">
                  {data
                    ? data.workspaceDefault
                      ? `${data.workspaceDefault.provider} / ${data.workspaceDefault.model}`
                      : "no default — pick a model to chat"
                    : "…"}
                </span>
              </span>
              {isDefault && <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em]">active</span>}
            </button>

            {providers.map((provider) => (
              <div key={provider.id} className="mt-1">
                <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                  {provider.name}
                  {!provider.keyPresent && (
                    <span className="inline-flex items-center gap-1 text-ember-300" title={`No ${provider.keyEnvVar} on the server`}>
                      <IconAlert size={10} /> no key
                    </span>
                  )}
                </p>
                {provider.models.map((model) => {
                  const active = preference?.provider === provider.id && preference?.model === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => pick(provider, model)}
                      disabled={!provider.keyPresent}
                      aria-disabled={!provider.keyPresent}
                      title={provider.keyPresent ? undefined : `Add ${provider.keyEnvVar} on the server to use ${provider.name}`}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] transition",
                        active ? "bg-signal-500/10 text-signal-200" : "text-zinc-300 hover:bg-white/[0.04]",
                        !provider.keyPresent && "cursor-not-allowed opacity-45 hover:bg-transparent",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{model.name}</span>
                        <span className="block truncate font-mono text-[10px] text-zinc-500">{model.id}</span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em]",
                          model.free ? "border-signal-400/30 text-signal-300" : "border-white/[0.08] text-zinc-500",
                        )}
                      >
                        {model.free ? "free" : "paid"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}

            {loadFailed && (
              <p className="px-3 py-3 text-[12px] text-ember-300">The model catalog could not be loaded.</p>
            )}

            {/* Memory-write approval (V1) — the only approval-gated tool. */}
            <div className="mt-1 border-t border-white/[0.06] p-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={memoryApproved}
                onClick={() => setMemoryApproved(!memoryApproved)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] text-zinc-300 transition hover:bg-white/[0.04]"
              >
                <span className="min-w-0">
                  <span className="block font-medium">Allow memory saving</span>
                  <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500">
                    {memoryApproved ? "Mem0 writes confirmed" : "Mem0 writes require approval"}
                  </span>
                </span>
                <span
                  className={cn(
                    "relative h-4 w-7 shrink-0 rounded-full transition",
                    memoryApproved ? "bg-signal-500/70" : "bg-zinc-700",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-3 w-3 rounded-full bg-zinc-100 transition-all",
                      memoryApproved ? "left-3.5" : "left-0.5",
                    )}
                  />
                </span>
              </button>
            </div>
            {data && providers.length === 0 && !loadFailed && (
              <p className="px-3 py-3 text-[12px] text-zinc-500">No allowlisted models are configured yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
