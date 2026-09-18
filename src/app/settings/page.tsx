import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { RoadmapPanel } from "@/components/roadmap-panel";
import { describeModelTarget, getModelConfig } from "@/lib/model";
import { getMaxMessageLength } from "@/lib/model/config";

// Read the environment per request so settings always reflect the live deployment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings — Ostra",
  description: "Resolved model link configuration for the Ostra runtime.",
};

export default function SettingsPage() {
  const config = getModelConfig();
  const target = describeModelTarget(config);

  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Provider mode",
      value: target.mode === "mock" ? "mock — simulated replies" : "http — live model endpoint",
    },
    { label: "Model name", value: target.model },
    { label: "Endpoint URL", value: target.endpointConfigured ? "configured (server-side)" : "not set" },
    { label: "Endpoint key", value: config.apiKey ? "configured (server-side)" : "not set" },
    { label: "Request format", value: target.apiFormat },
    { label: "Request timeout", value: `${Math.round(config.timeoutMs / 1000)} s` },
    { label: "Max message length", value: `${getMaxMessageLength()} characters` },
  ];

  return (
    <AppShell activeNav="settings">
      <RoadmapPanel
        eyebrow="Module 04 · Control"
        title="Settings"
        summary="Model configuration is intentionally environment-driven in v0: no secrets can be typed into this UI, listed in the repository or read by the browser. This view reports what the server resolved from its environment."
        working={[
          "Model provider, model name and request format are configurable",
          "Credentials stay in server environment variables",
          "Changing the model is a configuration change, not a code change",
        ]}
        planned={[
          "Editing provider settings from the interface",
          "Conversation export and import",
          "A credential vault for future tool integrations",
          "Telegram interface binding and notification routing",
        ]}
      >
        <section className="ostra-panel p-5 sm:p-6">
          <h2 className="text-sm font-medium text-zinc-200">Resolved model link</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            Read on the server for every request. Only presence is shown for credentials — values are never sent to
            the browser, logged, or stored in conversation history.
          </p>

          <dl className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13px] text-zinc-400">{row.label}</dt>
                <dd className="break-all text-right font-mono text-[12px] text-zinc-200">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 rounded-xl border border-white/[0.06] bg-void-950/60 p-4">
            <p className="ostra-label">Environment variables</p>
            <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-400">
              {`MODEL_MODE=mock
MODEL_API_URL=
MODEL_API_KEY=
MODEL_NAME=ostra-experimental`}
            </pre>
            <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">
              Set these in the hosting environment (for Vercel: Settings → Environment Variables) and redeploy.
              MODEL_MODE=http routes every reply through MODEL_API_URL; MODEL_MODE=mock keeps the simulated
              provider.
            </p>
          </div>
        </section>
      </RoadmapPanel>
    </AppShell>
  );
}
