import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { RoadmapPanel } from "@/components/roadmap-panel";
import { getProviderStatusSummary } from "@/lib/providers/config-status";
import { getMaxMessageLength } from "@/lib/model/config";

// Read the environment per request so settings always reflect the live deployment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings — Ostra",
  description: "Resolved model link configuration for the Ostra runtime.",
};

export default function SettingsPage() {
  const summary = getProviderStatusSummary();
  const ready = summary.mode === "ready";
  const keylessSelectable = summary.providers.filter((p) => p.endpointConfigured && !p.keyPresent);
  const keyedWithoutEndpoint = summary.providers.filter((p) => p.keyPresent && !p.endpointConfigured);

  const rows: Array<{ label: string; value: string; warn?: boolean }> = [
    {
      label: "Model selection",
      value: ready
        ? "no default — pick a provider and model per chat or set a workspace default"
        : "no provider is fully configured yet",
      warn: !ready,
    },
    { label: "Custom HTTP endpoint", value: summary.customEndpoint ? "configured (MODEL_API_URL)" : "not configured" },
    { label: "API format", value: summary.adapter ?? "openai-compatible" },
    {
      label: "Custom endpoint key",
      value: summary.keyPresent ? "present (server-side)" : "not set — only needed if the endpoint requires auth",
    },
    {
      label: "Run limits",
      value: `${summary.run.timeoutMs / 1000}s timeout · ${summary.run.maxTokens} max tokens · temp ${summary.run.temperature}`,
    },
    { label: "Max message length", value: `${getMaxMessageLength()} characters` },
  ];

  return (
    <AppShell activeNav="settings">
      <RoadmapPanel
        eyebrow="Module 04 · Control"
        title="Settings"
        summary="This view reports what the server resolved from its environment right now. Per-request and workspace model selection live in the chat header and the Model Control Center — both override the environment default below."
        working={[
          "Multi-provider gateway: OpenRouter, NVIDIA NIM, Gemini, Groq, Mistral, Custom HTTP",
          "Explicit user model selection — no global default provider or model",
          "Model Control Center at /models with allowlisted catalog selection",
          "Credentials stay in server environment variables",
          "Custom OpenAI-compatible endpoint via MODEL_API_URL",
        ]}
        planned={[
          "Editing provider settings from the interface",
          "Conversation export and import",
          "A credential vault for future tool integrations",
          "Telegram interface binding and notification routing",
        ]}
      >
        {/* No provider fully configured */}
        {!ready && (
          <div className="mx-5 mt-5 rounded-xl border border-ember-400/30 bg-ember-500/10 p-4 sm:mx-6">
            <p className="text-[13px] font-medium text-ember-400">No usable provider configured</p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
              Ostra has no default provider or model. Set the API key of any provider you want to use (or point{" "}
              <code className="text-zinc-300">MODEL_API_URL</code> at an OpenAI-compatible endpoint), then select that
              provider and model in the chat header or the Model Control Center.
            </p>
          </div>
        )}

        {/* Credential gaps — reported per provider, never as a global default */}
        {(keylessSelectable.length > 0 || keyedWithoutEndpoint.length > 0) && (
          <div className="mx-5 mt-5 rounded-xl border border-ember-400/30 bg-ember-500/10 p-4 sm:mx-6">
            <p className="text-[13px] font-medium text-ember-400">Configuration gaps</p>
            <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-zinc-400">
              {keylessSelectable.map((provider) => (
                <li key={`no-key-${provider.id}`}>
                  <code className="text-zinc-300">{provider.id}</code> has an endpoint but no{" "}
                  <code className="text-zinc-300">{provider.keyEnvVar}</code>.
                </li>
              ))}
              {keyedWithoutEndpoint.map((provider) => (
                <li key={`no-endpoint-${provider.id}`}>
                  <code className="text-zinc-300">{provider.id}</code> has a key but no endpoint configured.
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="ostra-panel p-5 sm:p-6">
          <h2 className="text-sm font-medium text-zinc-200">Model link</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            There is no global default provider or model: the provider and model the user selects are the ones used.
            Credentials are read on the server per request. Only presence is shown for credentials — values are never
            sent to the browser, logged, or stored in conversation history.
          </p>

          <dl className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13px] text-zinc-400">{row.label}</dt>
                <dd
                  className={`break-all text-right font-mono text-[12px] ${row.warn ? "text-red-400" : "text-zinc-200"}`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="ostra-panel p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-200">Available providers</h2>
            <Link
              href="/models"
              className="rounded-lg border border-signal-400/25 bg-signal-500/10 px-3 py-1.5 text-[12px] font-medium text-signal-200 transition hover:bg-signal-500/20"
            >
              Open Model Control Center →
            </Link>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            Providers become selectable once their key is present in the server environment. There is no default
            provider — pick one in the chat header or Model Control Center. Free tiers and availability may change —
            verify current status at each provider&apos;s documentation.
          </p>

          <dl className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {summary.providers.map((provider) => (
              <div key={provider.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13px] text-zinc-400">
                  {provider.name}
                  {provider.active && (
                    <span className="ml-2 inline-block rounded-full bg-signal-700/30 px-2 py-0.5 text-[11px] font-medium text-signal-400">
                      active
                    </span>
                  )}
                  {provider.active && !provider.keyPresent && (
                    <span className="ml-2 inline-block rounded-full bg-ember-500/20 px-2 py-0.5 text-[11px] font-medium text-ember-400">
                      no key
                    </span>
                  )}
                </dt>
                <dd className="flex flex-col items-end gap-1">
                  <span className="font-mono text-[12px] text-zinc-200">{provider.model}</span>
                  <span className="text-right text-[11px] text-zinc-500">
                    {provider.freeTier ? provider.freeTierNote : "paid — no free tier currently documented"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="ostra-panel p-5 sm:p-6">
          <p className="ostra-label">Credentials &amp; endpoint (environment)</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-400">
            {`# Credentials only — the provider/model choice is made in the UI
OPENROUTER_API_KEY=your-key
NVIDIA_API_KEY=your-key
GEMINI_API_KEY=your-key
GROQ_API_KEY=your-key
MISTRAL_API_KEY=your-key

# Optional custom OpenAI-compatible endpoint (select "Custom HTTP")
MODEL_API_URL=https://your-endpoint/v1
MODEL_API_KEY=your-key
MODEL_NAME=your-model-id`}
          </pre>
          <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">
            Set these in the hosting environment (for Vercel: Settings → Environment Variables) and redeploy. They
            provide credentials and endpoints — they never choose a provider or a model.
          </p>
        </section>
      </RoadmapPanel>
    </AppShell>
  );
}
