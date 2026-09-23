import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { RoadmapPanel } from "@/components/roadmap-panel";

export const metadata: Metadata = {
  title: "Memory — Ostra",
  description:
    "Ostra's memory layer: Mem0-backed recall and explicit user-requested memory saves through the tool pipeline.",
};

export default function MemoryPage() {
  return (
    <AppShell activeNav="memory">
      <RoadmapPanel
        eyebrow="Module 03 · Knowledge"
        title="Memory"
        summary="Ostra can now store and recall memory through the Mem0 integration: saves happen only when you explicitly ask Ostra to remember something (approval-gated), and relevant memories can be retrieved before answering. Long-term architecture for scopes, editing and a dedicated memory browser remains planned."
        working={[
          "Explicit saves via the approval-gated mem0.save_memory tool (enable 'Allow memory saving' in the chat header)",
          "Recall via mem0.search_memory when a question needs prior knowledge",
          "Recent turns of the active conversation are sent per request",
          "Conversations persist in this browser's local storage",
        ]}
        planned={[
          "Automatic (non-explicit) memory capture across conversations",
          "A dedicated memory browser with edit and forget controls",
          "Separate scopes for global knowledge and per-project context",
        ]}
      />
    </AppShell>
  );
}
