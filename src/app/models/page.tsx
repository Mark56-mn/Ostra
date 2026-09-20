import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ModelControlCenter } from "@/components/models/model-control-center";

export const metadata: Metadata = {
  title: "Models — Ostra",
  description: "Ostra's Model Control Center: browse the server-controlled catalog and configure task models.",
};

export default function ModelsPage() {
  return (
    <AppShell activeNav="models">
      <ModelControlCenter />
    </AppShell>
    );
}
