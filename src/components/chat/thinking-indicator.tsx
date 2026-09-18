import { OstraAvatar } from "@/components/ostra-mark";

const DOTS = [0, 1, 2];

export function ThinkingIndicator() {
  return (
    <li className="flex animate-fade-up gap-3" aria-live="polite">
      <OstraAvatar className="mt-0.5" />
      <div className="flex items-center gap-3 rounded-2xl rounded-bl-md border border-white/[0.06] bg-void-850/60 px-4 py-3.5">
        <span className="flex items-center gap-1" aria-hidden="true">
          {DOTS.map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-signal-400"
              style={{ animationDelay: `${dot * 0.16}s` }}
            />
          ))}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          Ostra is responding
        </span>
      </div>
    </li>
  );
}
