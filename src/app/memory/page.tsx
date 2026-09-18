import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { RoadmapPanel } from "@/components/roadmap-panel";

export const metadata: Metadata = {
  title: "Memory — Ostra",
  description: "Ostra has no persistent memory yet; conversations live in the browser only.",
};

export default function MemoryPage() {
  return (
    <AppShell activeNav="memory">
      <RoadmapPanel
        eyebrow="Module 03 · Knowledge"
        title="Memory"
        summary="Ostra does not remember anything between conversations. Each request carries only the recent turns of the conversation you are in, and nothing is stored on a server. Until a memory layer exists, this page will stay empty on purpose."
        working={[
          "Recent turns of the active conversation are sent per request",
          "Conversations persist in this browser's local storage",
          "The runtime already has a context hook for injected messages",
        ]}
        planned={[
          "A persistent memory store (Postgres or Supabase)",
          "Recall injected into the runtime before each model call",
          "Explicit write, edit and forget controls per memory item",
          "Separate scopes for global knowledge and per-project context",
        ]}
      />
    </AppShell>
  );
}
