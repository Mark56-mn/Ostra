import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { RoadmapPanel } from "@/components/roadmap-panel";
import { resolveProviderConfig, getAllProviderStatuses } from "@/lib/providers";
import { getMaxMessageLength } from "@/lib/model/config";

// Read the environment per request so settings always reflect the live deployment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings — Ostra",
  description: "Resolved model link configuration for the Ostra runtime.",
};

export default function SettingsPage() {
  const config = resolveProviderConfig();
  const allProviders = getAllProviderStatuses();
  const provider = config.provider;

  const hasError = Boolean(config.configError);
  const isMock = config.mode === "mock" && !provider;
  const keyMissing = Boolean(config.mode === "provider" && provider && !provider.apiKey);

  const rows: Array<{ label: string; value: string; warn?: boolean }> = [
    {
      label: "Active provider",
      value: hasError
        ? "ERROR — invalid provider"
        : isMock
          ? "mock — simulated replies"
          : provider?.id ?? "unknown",
      warn: hasError,
    },
    { label: "Model", value: provider?.model ?? "ostra-mock-1" },
    { label: "API format", value: provider?.adapter ?? "openai-compatible" },
    {
      label: "API key",
      value: hasError
        ? "N/A"
        : isMock
          ? "not needed (mock mode)"
          : provider?.apiKey
            ? "present (server-side)"
            : "MISSING — provider will fail",
      warn: keyMissing,
    },
    { label: "Max message length", value: `${getMaxMessageLength()} characters` },
  ];

  return (
    <AppShell activeNav="settings">
      <RoadmapPanel
        eyebrow="Module 04 · Control"
        title="Settings"
        summary="Model configuration is environment-driven: no secrets can be typed into this UI, listed in the repository, or read by the browser. This view reports what the server resolved from its environment."
        working={[
          "Multi-provider gateway: OpenRouter, NVIDIA NIM, Gemini, Groq, Mistral",
          "Environment-based provider switching — no code changes needed",
          "Credentials stay in server environment variables",
          "Legacy MODEL_MODE / MODEL_API_URL backward compatibility",
        ]}
        planned={[
          "Editing provider settings from the interface",
          "Conversation export and import",
          "A credential vault for future tool integrations",
          "Telegram interface binding and notification routing",
        ]}
      >
        {/* Config error banner */}
        {hasError && (
          <div className="mx-5 mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:mx-6">
            <p className="text-[13px] font-medium text-red-400">Configuration error</p>
            <p className="mt-1 font-mono text-[12px] text-red-300/80">{config.configError}</p>
            <p className="mt-2 text-[12px] text-zinc-500">
              Fix the AI_PROVIDER environment variable and redeploy.
            </p>
          </div>
        )}

        {/* Key missing warning */}
        {keyMissing && (
          <div className="mx-5 mt-5 rounded-xl border border-ember-400/30 bg-ember-500/10 p-4 sm:mx-6">
            <p className="text-[13px] font-medium text-ember-400">API key missing</p>
            <p className="mt-1 text-[12px] text-zinc-400">
              Provider <code className="text-zinc-300">{provider?.id}</code> is configured but no API key was found.
              Set <code className="text-zinc-300">{provider?.id.toUpperCase()}_API_KEY</code> or{" "}
              <code className="text-zinc-300">AI_API_KEY</code> in your environment.
            </p>
          </div>
        )}

        <section className="ostra-panel p-5 sm:p-6">
          <h2 className="text-sm font-medium text-zinc-200">Active provider</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            Read on the server for every request. Only presence is shown for credentials — values are never sent to
            the browser, logged, or stored in conversation history.
          </p>

          <dl className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13px] text-zinc-400">{row.label}</dt>
                <dd
                  className={`break-all text-right font-mono text-[12px] ${
                    row.warn ? "text-red-400" : "text-zinc-200"
                  }`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="ostra-panel p-5 sm:p-6">
          <h2 className="text-sm font-medium text-zinc-200">Available providers</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            Set <code className="text-signal-400">AI_PROVIDER</code> in your environment to switch.
            Free tiers and availability may change — verify current status at each provider&apos;s documentation.
          </p>

          <dl className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {allProviders.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13px] text-zinc-400">
                  {p.name}
                  {p.configured && (
                    <span className="ml-2 inline-block rounded-full bg-signal-700/30 px-2 py-0.5 text-[11px] font-medium text-signal-400">
                      active
                    </span>
                  )}
                  {p.configured && !p.keyPresent && (
                    <span className="ml-2 inline-block rounded-full bg-ember-500/20 px-2 py-0.5 text-[11px] font-medium text-ember-400">
                      no key
                    </span>
                  )}
                </dt>
                <dd className="flex flex-col items-end gap-1">
                  <span className="font-mono text-[12px] text-zinc-200">{p.model}</span>
                  <span className="text-[11px] text-zinc-500">
                    {p.freeTier ? p.freeTierNote : "paid"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="ostra-panel p-5 sm:p-6">
          <p className="ostra-label">Quick-start environment variables</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-400">
            {`# Pick one provider and set its key
AI_PROVIDER=groq
GROQ_API_KEY=your-key

# Or OpenRouter (free models with :free suffix)
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key

# Or legacy custom endpoint
MODEL_MODE=http
MODEL_API_URL=https://your-endpoint/v1/chat/completions
MODEL_API_KEY=your-key`}
          </pre>
          <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">
            Set these in the hosting environment (for Vercel: Settings → Environment Variables) and redeploy.
            Changing the model is a configuration change, not a code change.
          </p>
        </section>
      </RoadmapPanel>
    </AppShell>
  );
}
