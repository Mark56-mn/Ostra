/**
 * Workspace model-selection store (Stage 2).
 *
 * Persists deliberate model selections server-side. v0.2 uses an in-memory
 * store scoped to a server instance: selections survive revalidation but not
 * cold starts. The `ModelSelectionStore` shape is the seam a durable store
 * (D1/Postgres) slots into later without touching routes or UI.
 *
 * This stores selection *descriptors* only — provider/model/role strings.
 * It never stores API keys or any other secret.
 */
import type { ModelRole } from "./tasks-types";

export interface SelectionRef {
  provider: string;
  model: string;
  role: ModelRole;
}

export interface TaskConfigSnapshot {
  id: string;
  name: string;
  models: SelectionRef[];
  createdAt: string;
  /**
   * Deliberately not a queue state: Stage 2 only *configures* which models a
   * future task would use. No execution happens here (that is Stage 3+).
   */
  status: "configured";
}

export interface WorkspaceModelSelection {
  default: SelectionRef | null;
  taskConfig: TaskConfigSnapshot | null;
  updatedAt: string;
}

export interface ModelSelectionStore {
  getState(): WorkspaceModelSelection;
  setDefault(selection: SelectionRef): SelectionRef;
  setTaskConfig(input: { name: string; models: SelectionRef[] }): TaskConfigSnapshot;
  clearTaskConfig(): void;
  reset(): void;
}

function createId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

class InMemoryModelSelectionStore implements ModelSelectionStore {
  private state: WorkspaceModelSelection = {
    default: null,
    taskConfig: null,
    updatedAt: new Date(0).toISOString(),
  };

  getState(): WorkspaceModelSelection {
    return this.state;
  }

  setDefault(selection: SelectionRef): SelectionRef {
    const saved: SelectionRef = { ...selection };
    this.state = {
      ...this.state,
      default: saved,
      updatedAt: new Date().toISOString(),
    };
    return saved;
  }

  setTaskConfig(input: { name: string; models: SelectionRef[] }): TaskConfigSnapshot {
    const snapshot: TaskConfigSnapshot = {
      id: createId(),
      name: input.name,
      models: input.models.map((model) => ({ ...model })),
      createdAt: new Date().toISOString(),
      status: "configured",
    };
    this.state = {
      ...this.state,
      taskConfig: snapshot,
      updatedAt: snapshot.createdAt,
    };
    return snapshot;
  }

  clearTaskConfig(): void {
    this.state = { ...this.state, taskConfig: null, updatedAt: new Date().toISOString() };
  }

  reset(): void {
    this.state = { default: null, taskConfig: null, updatedAt: new Date(0).toISOString() };
  }
}

const globalStore = globalThis as unknown as { __ostraModelSelectionStore?: ModelSelectionStore };

export const modelSelectionStore: ModelSelectionStore =
  globalStore.__ostraModelSelectionStore ?? new InMemoryModelSelectionStore();

if (!globalStore.__ostraModelSelectionStore) {
  globalStore.__ostraModelSelectionStore = modelSelectionStore;
}
