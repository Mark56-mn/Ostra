"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MODEL_ROLE_LABELS, MODEL_ROLES, type ModelRole } from "@/lib/model-selection/tasks-types";
import { cn } from "@/lib/utils";
import { IconAlert, IconCheck, IconRefresh } from "@/components/icons";

/**
 * Model Control Center (Stage 2).
 *
 * Shows the server-controlled model catalog and lets the user make deliberate
 * selections: one default model, or a task configuration assigning roles to
 * one or more models. Every save is validated server-side against the
 * allowlist; providers without a configured key cannot be selected.
 */

interface CatalogModel {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  maxOutput: number;
  tags: string[];
  free: boolean;
  freeNote?: string;
}

interface CatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  keyEnvVar: string;
  adapter: string;
  docsUrl: string;
  freeTier: boolean;
  freeTierNote: string;
  models: CatalogModel[];
  keyPresent: boolean;
}

interface ModelsPayload {
  providers: CatalogProvider[];
  active: { mode: string; provider: string; model: string; keyPresent: boolean; configError: string | null };
  defaultSelection: { provider: string; model: string };
  timestamp: string;
}

interface TaskPick {
  provider: string;
  model: string;
  role: ModelRole;
}

type Notice = { kind: "ok" | "err"; text: string } | null;

export function ModelControlCenter() {
  const [data, setData] = useState<ModelsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [mode, setMode] = useState<"default" | "task">("default");
  const [taskPicks, setTaskPicks] = useState<Record<string, TaskPick>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ModelsPayload;
      setData(payload);
      setActiveProviderId((current) => current ?? payload.providers[0]?.id ?? null);
    } catch {
      setLoadError("The model catalog could not be loaded. Check the connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProvider = useMemo(
    () => data?.providers.find((provider) => provider.id === activeProviderId) ?? null,
    [data, activeProviderId],
  );

  const taskCount = Object.keys(taskPicks).length;

  function togglePick(model: CatalogModel, provider: CatalogProvider): void {
    const key = `${provider.id}::${model.id}`;
    setNotice(null);
    setTaskPicks((current) => {
      const next = { ...current };
      if (next[key]) {
        delete next[key];
      } else {
        if (Object.keys(next).length >= 5) {
          setNotice({ kind: "err", text: "At most 5 models can be assigned to one task configuration." });
          return current;
        }
        next[key] = { provider: provider.id, model: model.id, role: "general" };
      }
      return next;
    });
  }

  function setRole(key: string, role: ModelRole): void {
    setTaskPicks((current) => {
      const pick = current[key];
      if (!pick) return current;
      return { ...current, [key]: { ...pick, role } };
    });
  }

  async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    if (!response.ok) {
      return { ok: false, message: payload?.error?.message ?? `The server rejected the selection (HTTP ${response.status}).` };
    }
    return { ok: true, message: "Saved." };
  }

  async function setDefaultModel(provider: CatalogProvider, model: CatalogModel): Promise<void> {
    if (!provider.keyPresent || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await post("/api/models/select", { provider: provider.id, model: model.id });
    setNotice({ kind: result.ok ? "ok" : "err", text: result.ok ? `Default model set: ${model.name} (${provider.name}).` : result.message });
    setBusy(false);
  }

  async function saveTaskConfig(): Promise<void> {
    if (taskCount === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    const models = Object.values(taskPicks);
    const result = await post("/api/models/select", {
      name: `Task configuration · ${new Date().toLocaleString()}`,
      models,
    });
    setNotice({
      kind: result.ok ? "ok" : "err",
      text: result.ok
        ? `Task configuration saved with ${models.length} model${models.length === 1 ? "" : "s"}. It defines which models a future task will use — nothing is executed yet.`
        : result.message,
    });
    setBusy(false);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {/* Header */}
        <header className="ostra-panel animate-fade-up p-5 sm:p-6">
          <p className="ostra-label">Module 05 · Model control</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Model Control Center</h1>
          <p className="mt-3 text-pretty-ostra text-sm leading-relaxed text-zinc-400">
            The catalog below is controlled by the server and allowlisted — only listed models can be selected, and
            providers without a configured API key are locked. Keys never appear here; only whether one exists.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {data ? (
              <>
                <span className="ostra-chip border-signal-400/25 text-signal-300">
                  active: {data.active.provider} / {data.active.model}
                </span>
                <span className={cn("ostra-chip", data.active.keyPresent ? "text-signal-300" : "border-ember-400/30 text-ember-300")}>
                  {data.active.keyPresent ? "key present" : data.active.mode === "mock" ? "mock mode" : "key missing"}
                </span>
              </>
            ) : (
              <span className="ostra-chip">loading catalog…</span>
            )}
          </div>
        </header>

        {/* Notices */}
        <div aria-live="polite">
          {notice && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3.5 text-[13px] leading-relaxed",
                notice.kind === "ok"
                  ? "border-signal-400/30 bg-signal-500/10 text-signal-200"
                  : "border-red-500/30 bg-red-500/10 text-red-200",
              )}
            >
              {notice.kind === "ok" ? <IconCheck size={15} className="mt-0.5 shrink-0" /> : <IconAlert size={15} className="mt-0.5 shrink-0" />}
              <span>{notice.text}</span>
            </div>
          )}
          {loadError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-[13px] text-red-200">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span className="flex-1">{loadError}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-zinc-200 transition hover:bg-white/[0.06]"
              >
                <IconRefresh size={13} /> Retry
              </button>
            </div>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2" role="tablist" aria-label="Selection mode">
          {(
            [
              { id: "default" as const, label: "Default model" },
              { id: "task" as const, label: `Task configuration${taskCount > 0 ? ` · ${taskCount}` : ""}` },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              onClick={() => {
                setMode(tab.id);
                setNotice(null);
              }}
              className={cn(
                "min-h-[44px] flex-1 rounded-xl border px-4 text-sm font-medium transition",
                mode === tab.id
                  ? "border-signal-400/30 bg-signal-500/10 text-signal-200"
                  : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Provider rail */}
        {data && data.providers.length > 0 && (
          <div className="ostra-panel p-3">
            <p className="ostra-label px-2 pb-2">Providers</p>
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Model providers">
              {data.providers.map((provider) => {
                const active = provider.id === activeProviderId;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveProviderId(provider.id)}
                    className={cn(
                      "flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium transition",
                      active
                        ? "border-signal-400/30 bg-signal-500/10 text-signal-200"
                        : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200",
                    )}
                  >
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", provider.keyPresent ? "bg-signal-400" : "bg-zinc-600")}
                      aria-hidden
                    />
                    {provider.name}
                    {provider.models.length > 0 && (
                      <span className="font-mono text-[10px] text-zinc-500">{provider.models.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {activeProvider && (
              <p className="mt-2 px-2 text-[12px] leading-relaxed text-zinc-500">
                {activeProvider.freeTierNote}{" "}
                <a
                  href={activeProvider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal-400 underline-offset-2 hover:underline"
                >
                  Docs ↗
                </a>
              </p>
            )}
          </div>
        )}

        {/* Model cards */}
        {loading && !data ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
            ))}
          </div>
        ) : (
          activeProvider && (
            <section>
              <h2 className="ostra-label px-1 pb-2">{activeProvider.name} models</h2>
              {activeProvider.models.length === 0 ? (
                <div className="ostra-panel p-5 text-[13px] leading-relaxed text-zinc-400">
                  No models are allowlisted for this provider yet. Add verified model IDs to the server catalog to
                  offer them here.
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {activeProvider.models.map((model) => {
                    const key = `${activeProvider.id}::${model.id}`;
                    const picked = Boolean(taskPicks[key]);
                    const isServerDefault = data?.defaultSelection.provider === activeProvider.id && data.defaultSelection.model === model.id;
                    return (
                      <li key={model.id} className="ostra-panel flex flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-medium leading-snug text-zinc-100">{model.name}</h3>
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]",
                              model.free ? "border-signal-400/30 text-signal-300" : "border-white/[0.08] text-zinc-500",
                            )}
                          >
                            {model.free ? "free tier*" : "paid"}
                          </span>
                        </div>
                        <p className="mt-1.5 font-mono text-[11px] leading-snug text-zinc-500">{model.id}</p>
                        <p className="mt-2 flex-1 text-[13px] leading-relaxed text-zinc-400">{model.description}</p>
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-600">
                          ctx {formatTokens(model.contextWindow)} · out {formatTokens(model.maxOutput)}
                        </p>

                        {mode === "default" ? (
                          <button
                            type="button"
                            disabled={!activeProvider.keyPresent || busy}
                            onClick={() => void setDefaultModel(activeProvider, model)}
                            className={cn(
                              "mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-xl border text-[13px] font-medium transition active:scale-[0.99]",
                              activeProvider.keyPresent
                                ? "border-signal-400/30 bg-signal-500/10 text-signal-200 hover:bg-signal-500/20"
                                : "cursor-not-allowed border-white/[0.08] bg-white/[0.02] text-zinc-600",
                            )}
                          >
                            {!activeProvider.keyPresent && <IconAlert size={13} />}
                            {activeProvider.keyPresent ? (isServerDefault ? "Server default" : "Use as default") : `No ${activeProvider.keyEnvVar}`}
                          </button>
                        ) : (
                          <div className="mt-3 flex flex-col gap-2">
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 text-[13px] text-zinc-300">
                              <input
                                type="checkbox"
                                checked={picked}
                                onChange={() => togglePick(model, activeProvider)}
                                className="h-4 w-4 accent-[#3fd8a8]"
                              />
                              {picked ? "Assigned to task" : "Assign to task"}
                            </label>
                            <select
                              aria-label={`Role for ${model.name}`}
                              disabled={!picked}
                              value={picked ? taskPicks[key]?.role ?? "general" : "general"}
                              onChange={(event) => setRole(key, event.target.value as ModelRole)}
                              className={cn(
                                "min-h-[44px] rounded-xl border border-white/[0.08] bg-void-800 px-3 text-[13px] text-zinc-200 outline-none transition",
                                picked ? "opacity-100" : "cursor-not-allowed opacity-40",
                              )}
                            >
                              {MODEL_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {MODEL_ROLE_LABELS[role]} — {role}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )
        )}

        {/* Task config save bar */}
        {mode === "task" && (
          <div className="ostra-panel sticky bottom-0 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-relaxed text-zinc-500">
              {taskCount === 0
                ? "Assign at least one model to save a task configuration."
                : `${taskCount} model${taskCount === 1 ? "" : "s"} assigned. This only defines which models a future task would use — nothing runs yet.`}
            </p>
            <button
              type="button"
              disabled={taskCount === 0 || busy}
              onClick={() => void saveTaskConfig()}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-5 text-[13px] font-medium transition active:scale-[0.99]",
                taskCount > 0
                  ? "border-signal-400/30 bg-signal-500/10 text-signal-200 hover:bg-signal-500/20"
                  : "cursor-not-allowed border-white/[0.08] bg-white/[0.02] text-zinc-600",
              )}
            >
              {busy ? "Saving…" : "Save configuration"}
            </button>
          </div>
        )}

        <p className="px-1 pb-2 text-[11px] leading-relaxed text-zinc-600">
          * &ldquo;Free tier&rdquo; means a free tier or free credits are documented by the provider today.
          Availability, limits and model IDs change without notice — verify at the provider&apos;s docs before
          relying on it.
        </p>
      </div>
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
