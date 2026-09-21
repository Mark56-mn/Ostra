/**
 * Tool configuration store (Stage 2).
 *
 * Persists per-workspace tool state: enable/disable flags and default
 * approval overrides. In-memory with the same durable-store seam as the
 * model selection store — Stage 3+ swaps the implementation, not the call
 * sites. Stores configuration only; never secrets.
 */
import type { ToolDefinition } from "./types";

export interface ToolOverride {
  /** Whether the workspace has deliberately enabled this tool. */
  enabled?: boolean;
  /** Deliberate approval-policy override. */
  approval?: "always" | "never";
  updatedBy?: "workspace";
}

export interface ToolConfigSnapshot {
  overrides: Record<string, ToolOverride>;
  updatedAt: string;
}

export interface ToolConfigStore {
  getSnapshot(): ToolConfigSnapshot;
  isEnabled(tool: ToolDefinition): boolean;
  requiresApproval(tool: ToolDefinition): boolean;
  setEnabled(toolId: string, enabled: boolean): ToolConfigSnapshot;
  setApproval(toolId: string, approval: "always" | "never" | null): ToolConfigSnapshot;
  reset(): void;
}

class InMemoryToolConfigStore implements ToolConfigStore {
  private snapshot: ToolConfigSnapshot = { overrides: {}, updatedAt: new Date(0).toISOString() };

  getSnapshot(): ToolConfigSnapshot {
    return this.snapshot;
  }

  isEnabled(tool: ToolDefinition): boolean {
    const override = this.snapshot.overrides[tool.id];
    return override?.enabled ?? tool.enabled;
  }

  requiresApproval(tool: ToolDefinition): boolean {
    const override = this.snapshot.overrides[tool.id];
    if (override?.approval === "always") return true;
    if (override?.approval === "never") {
      // Financial and destructive tools can never skip confirmation — the
      // invariant holds even if the store is mutated directly.
      if (tool.permission === "financial" || tool.permission === "destructive") return true;
      return false;
    }
    return tool.requiresApproval;
  }

  setEnabled(toolId: string, enabled: boolean): ToolConfigSnapshot {
    this.snapshot = {
      overrides: { ...this.snapshot.overrides, [toolId]: { ...this.snapshot.overrides[toolId], enabled } },
      updatedAt: new Date().toISOString(),
    };
    return this.snapshot;
  }

  setApproval(toolId: string, approval: "always" | "never" | null): ToolConfigSnapshot {
    const existing = { ...this.snapshot.overrides[toolId] };
    if (approval === null) {
      delete existing.approval;
    } else {
      existing.approval = approval;
    }
    this.snapshot = {
      overrides: { ...this.snapshot.overrides, [toolId]: existing },
      updatedAt: new Date().toISOString(),
    };
    return this.snapshot;
  }

  reset(): void {
    this.snapshot = { overrides: {}, updatedAt: new Date(0).toISOString() };
  }
}

const globalStore = globalThis as unknown as { __ostraToolConfigStore?: ToolConfigStore };

export const toolConfigStore: ToolConfigStore =
  globalStore.__ostraToolConfigStore ?? new InMemoryToolConfigStore();

if (!globalStore.__ostraToolConfigStore) {
  globalStore.__ostraToolConfigStore = toolConfigStore;
}
