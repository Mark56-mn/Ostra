/**
 * The Ostra sigil — a ringed core with a single accent arc. Used as the
 * brand mark in the sidebar, the chat header and message avatars.
 */
import { cn } from "@/lib/utils";

export function OstraMark({
  size = 28,
  className,
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <circle cx="24" cy="24" r="19" stroke="currentColor" strokeWidth="1.4" opacity="0.28" />
      <circle cx="24" cy="24" r="13" stroke="currentColor" strokeWidth="1" opacity="0.16" />
      <circle cx="24" cy="24" r="5.4" fill="currentColor" opacity="0.95" />
      <g className={animated ? "origin-center animate-orbit" : undefined}>
        <path
          d="M24 5a19 19 0 0 1 19 19"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="43" cy="24" r="2.4" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Small avatar used beside Ostra's replies. */
export function OstraAvatar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-signal-400/25 bg-signal-500/10 text-signal-300",
        className,
      )}
    >
      <OstraMark size={18} />
    </span>
  );
}
