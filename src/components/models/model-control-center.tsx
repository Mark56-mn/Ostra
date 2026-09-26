"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MODEL_ROLE_LABELS, MODEL_ROLES, type ModelRole } from "@/lib/model-selection/tasks-types";
import { cn } from "@/lib/utils";
import { IconAlert, IconCheck, IconRefresh } from "@/components/icons";

/**
 * Model & Tool Control Center (Stage 2).
 *
 * Three server-mirrored sections:
 * - Models: allowlisted catalog + verified capabilities + selection.
 * - Tools: allowlisted tool registry with live enablement and permission data.
 * - Integrations: Vercel Connect catalog with honest connection states.
 *
 * Every save/validate call hits the server; keys and tokens never appear here.
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

interface CapabilityEntry {
  modelId: string;
  providerId: string;
  capabilities: Record<string, boolean | "unknown" | undefined>;
  verifiedAt: string;
  verifiedFrom: string;
}

interface ModelsPayload {
  providers: CatalogProvider[];
  capabilities: CapabilityEntry[];
  /** Model-link readiness. There is no globally active provider or model. */
  active: { mode: string; provider: string; model: string; keyPresent: boolean; selectableProviders: string[] };
  /** The deliberate workspace default, or null when none is set. */
  defaultSelection: { provider: string; model: string } | null;
  timestamp: string;
}

interface ToolStatus {
  id: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  executionType: string;
  permission: string;
  riskLevel: string;
  enabled: boolean;
  requiresApproval: boolean;
  requiresAuthentication: boolean;
  available: boolean;
}

interface ToolsPayload {
  tools: ToolStatus[];
  counts: { total: number; enabled: number; byExecutionType: Record<string, number> };
  timestamp: string;
}

interface IntegrationStatus {
  id: string;
  name: string;
  provider: string;
  tier: 1 | 2;
  category: string;
  description: string;
  capabilities: string[];
  connected: boolean;
  enabled: boolean;
  state: "available" | "connected" | "enabled" | "authorized" | "unavailable";
  note: string;
}

interface IntegrationsPayload {
  integrations: IntegrationStatus[];
  counts: { total: number; tier1: number; connected: number };
  catalogGaps: string[];
  catalogSource: string;
  catalogCheckedAt: string;
  timestamp: string;
}

interface TaskPick {
  provider: string;
  model: string;
  role: ModelRole;
}

type Notice = { kind: "ok" | "err"; text: string } | null;
type Tab = "models" | "tools" | "integrations";

const CAPABILITY_LABELS: Record<string, string> = {
  toolCalling: "tools",
  structuredOutput: "structured",
  vision: "vision",
  codeExecution: "code exec",
  reasoning: "reasoning",
  streaming: "streaming",
};

export function ModelControlCenter() {
  const [tab, setTab] = useState<Tab>("models");
  const [data, setData] = useState<ModelsPayload | null>(null);
  const [tools, setTools] = useState<ToolsPayload | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsPayload | null>(null);
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
      const [modelsRes, toolsRes, integrationsRes] = await Promise.all([
        fetch("/api/models", { cache: "no-store" }),
        fetch("/api/tools", { cache: "no-store" }),
        fetch("/api/integrations", { cache: "no-store" }),
      ]);
      if (!modelsRes.ok) throw new Error(`models HTTP ${modelsRes.status}`);
      const modelsPayload = (await modelsRes.json()) as ModelsPayload;
      setData(modelsPayload);
      // No provider is preselected. Ostra has no default provider, and
      // defaulting to catalog order made OpenRouter (first in PROVIDERS)
      // look like a hidden default. An explicit pick is required instead.
      setActiveProviderId((current) => (current && modelsPayload.providers.some((p) => p.id === current) ? current : null));
      if (toolsRes.ok) setTools((await toolsRes.json()) as ToolsPayload);
      if (integrationsRes.ok) setIntegrations((await integrationsRes.json()) as IntegrationsPayload);
    } catch {
      setLoadError("The control center catalog could not be loaded. Check the connection and retry.");
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

  // Providers that are actually usable are the ones a user can select.
  // Listing locked providers first would present one as the natural choice.
  const selectableProviderCount = data?.providers.filter((provider) => provider.keyPresent).length ?? 0;

  const capabilitiesFor = useCallback(
    (providerId: string, modelId: string) =>
      data?.capabilities.find((c) => c.providerId === providerId && c.modelId === modelId) ?? null,
    [data],
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
      return { ok: false, message: payload?.error?.message ?? `The server rejected the request (HTTP ${response.status}).` };
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

  async function toggleTool(tool: ToolStatus): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await post("/api/tools/configure", { toolId: tool.id, enabled: !tool.enabled });
    if (result.ok) {
      setTools((current) =>
        current
          ? {
              ...current,
              tools: current.tools.map((t) => (t.id === tool.id ? { ...t, enabled: !tool.enabled } : t)),
            }
          : current,
      );
      setNotice({ kind: "ok", text: `${tool.name} ${tool.enabled ? "disabled" : "enabled"} server-side.` });
    } else {
      setNotice({ kind: "err", text: result.message });
    }
    setBusy(false);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {/* Header */}
        <header className="ostra-panel animate-fade-up p-5 sm:p-6">
          <p className="ostra-label">Module 05 · Control center</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Model &amp; Tool Control Center</h1>
          <p className="mt-3 text-pretty-ostra text-sm leading-relaxed text-zinc-400">
            Models, tools and integrations are allowlisted and validated server-side. Keys and connection tokens never
            appear here — only whether they exist.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {data ? (
              <>
                <span className="ostra-chip border-signal-400/25 text-signal-300">
                  no default model · {data.active.selectableProviders.length} selectable
                </span>
                <span className={cn("ostra-chip", data.active.keyPresent ? "text-signal-300" : "border-ember-400/30 text-ember-300")}>
                  {data.active.keyPresent
                    ? `${selectableProviderCount} provider${selectableProviderCount === 1 ? "" : "s"} selectable`
                    : "no provider is selectable"}
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

        {/* Section tabs */}
        <div className="flex gap-2" role="tablist" aria-label="Control center sections">
          {(
            [
              { id: "models" as const, label: `Models${data ? ` · ${data.providers.reduce((n, p) => n + p.models.length, 0)}` : ""}` },
              { id: "tools" as const, label: `Tools${tools ? ` · ${tools.counts.enabled}/${tools.counts.total}` : ""}` },
              { id: "integrations" as const, label: `Integrations${integrations ? ` · ${integrations.counts.tier1} tier-1` : ""}` },
            ]
          ).map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={tab === section.id}
              onClick={() => {
                setTab(section.id);
                setNotice(null);
              }}
              className={cn(
                "min-h-[44px] flex-1 rounded-xl border px-3 text-[13px] font-medium transition",
                tab === section.id
                  ? "border-signal-400/30 bg-signal-500/10 text-signal-200"
                  : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200",
              )}
            >
              {section.label}
            </button>
          ))}
        </div>

        {/* ============================== MODELS ============================== */}
        {tab === "models" && (
          <>
            <div className="flex gap-2" role="tablist" aria-label="Selection mode">
              {(
                [
                  { id: "default" as const, label: "Default model" },
                  { id: "task" as const, label: `Task configuration${taskCount > 0 ? ` · ${taskCount}` : ""}` },
                ]
              ).map((modeTab) => (
                <button
                  key={modeTab.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === modeTab.id}
                  onClick={() => {
                    setMode(modeTab.id);
                    setNotice(null);
                  }}
                  className={cn(
                    "min-h-[44px] flex-1 rounded-xl border px-4 text-sm font-medium transition",
                    mode === modeTab.id
                      ? "border-signal-400/30 bg-signal-500/10 text-signal-200"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {modeTab.label}
                </button>
              ))}
            </div>

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
                        {!provider.keyPresent && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-600">no key</span>
                        )}
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

            {loading && !data ? (
              <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
                ))}
              </div>
            ) : !activeProvider ? (
              <div className="ostra-panel p-6 text-center">
                <p className="text-[13px] font-medium text-zinc-200">No provider selected</p>
                <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-zinc-400">
                  Ostra has no default provider. Choose one above to see its allowlisted models — a provider without a
                  key is listed but locked, and its models cannot be selected until the server has its credential.
                </p>
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
                        const isServerDefault =
                          data?.defaultSelection?.provider === activeProvider.id && data.defaultSelection.model === model.id;
                        const caps = capabilitiesFor(activeProvider.id, model.id);
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

                            {/* Verified capabilities */}
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {caps ? (
                                Object.entries(CAPABILITY_LABELS).map(([cap, label]) => {
                                  const value = caps.capabilities[cap];
                                  if (value === undefined) return null;
                                  return (
                                    <span
                                      key={cap}
                                      title={`${label}: ${value === "unknown" ? "unverified" : value ? "yes" : "no"} (verified ${caps.verifiedAt})`}
                                      className={cn(
                                        "rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
                                        value === true
                                          ? "border-signal-400/25 text-signal-300/90"
                                          : value === false
                                            ? "border-white/[0.07] text-zinc-600 line-through"
                                            : "border-ember-400/25 text-ember-300/80",
                                      )}
                                    >
                                      {value === "unknown" ? `${label}?` : label}
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="rounded-md border border-ember-400/25 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-ember-300/80">
                                  capabilities unverified
                                </span>
                              )}
                            </div>

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
              Capability chips show verified values — amber with &ldquo;?&rdquo; means unverified, never assumed.
              Availability and model IDs change without notice.
            </p>
          </>
        )}

        {/* ============================== TOOLS ============================== */}
        {tab === "tools" && (
          <section className="flex flex-col gap-3">
            <p className="px-1 text-[12px] leading-relaxed text-zinc-500">
              The tool registry is server-controlled. Enablement and permission levels are enforced before any tool is
              attached to a model request or executed; financial and destructive tools can never skip confirmation.
            </p>
            {tools ? (
              Object.entries(
                tools.tools.reduce<Record<string, ToolStatus[]>>((acc, tool) => {
                  (acc[tool.category] ??= []).push(tool);
                  return acc;
                }, {}),
              ).map(([category, categoryTools]) => (
                <div key={category} className="ostra-panel divide-y divide-white/[0.04] p-0">
                  <p className="ostra-label px-4 pt-4">{category}</p>
                  <ul>
                    {categoryTools.map((tool) => (
                      <li key={tool.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[13px] font-medium text-zinc-100">{tool.name}</h3>
                            <span
                              className={cn(
                                "rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
                                tool.enabled
                                  ? "border-signal-400/25 text-signal-300/90"
                                  : "border-white/[0.08] text-zinc-600",
                              )}
                            >
                              {tool.enabled ? "enabled" : "disabled"}
                            </span>
                            <span
                              className={cn(
                                "rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em]",
                                tool.permission === "financial" || tool.permission === "destructive"
                                  ? "border-ember-400/30 text-ember-300"
                                  : tool.permission === "external_action" || tool.permission === "execute"
                                    ? "border-amber-400/25 text-amber-300/90"
                                    : "border-white/[0.08] text-zinc-500",
                              )}
                            >
                              {tool.permission.replace("_", " ")}
                            </span>
                            {tool.requiresApproval && (
                              <span className="rounded-md border border-amber-400/25 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-amber-300/90">
                                confirm
                              </span>
                            )}
                            {tool.requiresAuthentication && (
                              <span className="rounded-md border border-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-zinc-500">
                                needs connection
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-mono text-[10px] leading-snug text-zinc-600">{tool.id}</p>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{tool.description}</p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-600">
                            {tool.executionType} · risk {tool.riskLevel} · via {tool.provider}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleTool(tool)}
                          className={cn(
                            "flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border px-4 text-[13px] font-medium transition active:scale-[0.99] sm:min-w-[110px]",
                            tool.enabled
                              ? "border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:bg-white/[0.06]"
                              : "border-signal-400/30 bg-signal-500/10 text-signal-200 hover:bg-signal-500/20",
                          )}
                        >
                          {tool.enabled ? "Disable" : "Enable"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="ostra-panel p-5 text-[13px] text-zinc-400">The tool registry could not be loaded.</div>
            )}
          </section>
        )}

        {/* =========================== INTEGRATIONS =========================== */}
        {tab === "integrations" && (
          <section className="flex flex-col gap-3">
            <p className="px-1 text-[12px] leading-relaxed text-zinc-500">
              Connectors verified against the{" "}
              <a href={integrations?.catalogSource ?? "https://vercel.com/connect/browse"} target="_blank" rel="noreferrer" className="text-signal-400 underline-offset-2 hover:underline">
                current Vercel Connect catalog
              </a>
              {integrations ? ` (checked ${integrations.catalogCheckedAt})` : ""}. A connector existing in Vercel does
              not mean Ostra is connected — connections are only confirmed by a live scoped-token probe after you
              connect them in the Vercel dashboard.
            </p>
            {integrations ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <span className="ostra-chip">{integrations.counts.total} registered</span>
                  <span className="ostra-chip border-signal-400/25 text-signal-300">tier 1 · {integrations.counts.tier1}</span>
                  <span className="ostra-chip">connected · {integrations.counts.connected}</span>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {integrations.integrations.map((integration) => (
                    <li key={integration.id} className="ostra-panel flex flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium leading-snug text-zinc-100">{integration.name}</h3>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]",
                            integration.state === "authorized" || integration.state === "connected"
                              ? "border-signal-400/30 text-signal-300"
                              : integration.state === "enabled"
                                ? "border-signal-400/20 text-signal-300/70"
                                : integration.state === "available"
                                  ? "border-white/[0.08] text-zinc-500"
                                  : "border-ember-400/30 text-ember-300",
                          )}
                        >
                          {integration.state}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{integration.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {integration.capabilities.slice(0, 4).map((capability) => (
                          <span key={capability} className="rounded-md border border-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                            {capability}
                          </span>
                        ))}
                        {integration.capabilities.length > 4 && (
                          <span className="font-mono text-[9px] text-zinc-600">+{integration.capabilities.length - 4}</span>
                        )}
                      </div>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-600">
                        {integration.provider} · tier {integration.tier} · {integration.category}
                      </p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{integration.note}</p>
                    </li>
                  ))}
                </ul>
                {integrations.catalogGaps.length > 0 && (
                  <div className="ostra-panel p-4 text-[12px] leading-relaxed text-zinc-500">
                    <p className="ostra-label pb-1">Catalog gaps (requested, not standalone connectors)</p>
                    <ul className="list-inside list-disc space-y-0.5">
                      {integrations.catalogGaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="ostra-panel p-5 text-[13px] text-zinc-400">The integration catalog could not be loaded.</div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
