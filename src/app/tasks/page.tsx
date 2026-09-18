import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { RoadmapPanel } from "@/components/roadmap-panel";

export const metadata: Metadata = {
  title: "Tasks — Ostra",
  description: "Ostra's task queue and scheduler are planned for a later phase.",
};

export default function TasksPage() {
  return (
    <AppShell activeNav="tasks">
      <RoadmapPanel
        eyebrow="Module 02 · Scheduler"
        title="Tasks"
        summary="This is where Ostra will run work on its own: queued jobs, recurring schedules and long-running operations it picked up from a conversation. Version 0 has no queue, no worker and no scheduler — nothing here is executing in the background."
        working={[
          "Conversations with Ostra through POST /api/chat",
          "A replaceable model adapter (mock now, HTTP endpoint next)",
          "An agent runtime the future task worker will reuse",
        ]}
        planned={[
          "A durable task queue with per-job status and retries",
          "Scheduled and recurring runs driven by a scheduler",
          "A human approval gate before any action is taken",
          "An append-only event log so every autonomous step is auditable",
        ]}
      />
    </AppShell>
  );
}
