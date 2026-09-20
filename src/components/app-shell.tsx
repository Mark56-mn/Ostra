"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useChat } from "@/hooks/use-chat";
import { IconMenu } from "./icons";
import { OstraMark } from "./ostra-mark";
import { Sidebar, type NavId } from "./sidebar";
import { SystemStatusChip } from "./system-status";

const SECTION_TITLES: Record<NavId, string> = {
  conversations: "Conversations",
  models: "Models",
  tasks: "Tasks",
  memory: "Memory",
  settings: "Settings",
};

export function AppShell({ activeNav, children }: { activeNav: NavId; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const { systemInfo, systemStatusFailed } = useChat();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen]);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      <Sidebar activeNav={activeNav} open={navOpen} onClose={() => setNavOpen(false)} />

      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-void-950/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-void-950/85 px-3 py-2.5 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="ostra-sidebar"
            className="rounded-xl border border-white/[0.08] p-2.5 text-zinc-300 transition active:scale-95"
          >
            <IconMenu size={18} />
          </button>
          <span className="flex min-w-0 items-center gap-2">
            <OstraMark size={20} className="text-signal-300" />
            <span className="flex min-w-0 flex-col leading-none">
              <span className="truncate text-xs font-semibold tracking-[0.28em] text-zinc-100">OSTRA</span>
              <span className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                {SECTION_TITLES[activeNav]}
              </span>
            </span>
          </span>
          <SystemStatusChip
            systemInfo={systemInfo}
            failed={systemStatusFailed}
            className="ml-auto shrink-0"
          />
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
