import type { ReactNode } from "react";
import { IconCheck, IconClock } from "@/components/icons";

/**
 * Honest placeholder used by sections that exist in the navigation but are not
 * implemented in v0. It states what works today and what is planned instead of
 * simulating a feature that does not exist yet.
 */
export function RoadmapPanel({
  eyebrow,
  title,
  summary,
  working,
  planned,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  working: string[];
  planned: string[];
  children?: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="ostra-panel animate-fade-up p-5 sm:p-6">
          <p className="ostra-label">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
          <p className="mt-3 text-pretty-ostra text-sm leading-relaxed text-zinc-400">{summary}</p>
          <span className="ostra-chip mt-4 border-ember-400/25 text-ember-300">Not in v0</span>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="ostra-panel p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-signal-400/25 bg-signal-500/10 text-signal-300">
                <IconCheck size={13} />
              </span>
              Available today
            </h2>
            <ul className="mt-4 space-y-3">
              {working.map((item) => (
                <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-zinc-400">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-signal-400/70" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="ostra-panel p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400">
                <IconClock size={13} />
              </span>
              Planned for a later phase
            </h2>
            <ol className="mt-4 space-y-3">
              {planned.map((item, index) => (
                <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-zinc-400">
                  <span className="font-mono text-[10px] leading-6 text-zinc-600">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {children}
      </div>
    </div>
  );
}
