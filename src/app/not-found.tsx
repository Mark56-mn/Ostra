import Link from "next/link";
import { OstraMark } from "@/components/ostra-mark";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="ostra-panel w-full max-w-md p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-signal-400/25 bg-signal-500/10 text-signal-300">
          <OstraMark size={28} />
        </span>
        <p className="ostra-label mt-4">Error 404</p>
        <h1 className="mt-2 text-lg font-semibold text-zinc-100">This route is not part of Ostra v0</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
          Only the conversation interface, tasks, memory and settings exist in this prototype.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center justify-center rounded-xl border border-signal-400/30 bg-signal-500/10 px-4 py-2.5 text-sm font-medium text-signal-200 transition hover:bg-signal-500/20"
        >
          Back to Ostra
        </Link>
      </div>
    </div>
  );
}
