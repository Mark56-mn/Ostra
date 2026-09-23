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
        summary="Scheduled, unattended Ostra runs — queued jobs, recurring schedules and background operations — are the next layer. The agent runtime they will reuse already exists and executes tools today; nothing runs in the background yet, and this page will light up when the scheduler lands."
        working={[
          "Conversations with Ostra through POST /api/chat, with real model selection",
          "Tool execution through the runtime: datetime, web search, web fetch, memory, GitHub",
          "Multi-provider gateway (OpenRouter, NVIDIA NIM, Gemini, Groq, Mistral)",
          "Task model configurations saved in the Model Control Center",
        ]}
        planned={[
          "A durable task queue with per-job status and retries",
          "Scheduled and recurring runs driven by a scheduler",
          "A human approval gate before any autonomous action",
          "An append-only event log so every autonomous step is auditable",
        ]}
      />
    </AppShell>
  );
}
