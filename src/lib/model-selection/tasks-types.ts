/**
 * Model role definitions — Stage 2 task routing vocabulary.
 *
 * Kept zod-free and import-cycle-free so both the selection service and the
 * task configuration schemas can use it. Roles are labels a task carries;
 * they do not change model behavior by themselves.
 */

export const MODEL_ROLES = ["planner", "coder", "reviewer", "executor", "general"] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  executor: "Executor",
  general: "General",
};

export const MODEL_ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
  planner: "High-level reasoning, strategy, and task decomposition",
  coder: "Code generation, editing, and debugging",
  reviewer: "Code review, quality checks, and verification",
  executor: "Direct execution, tool use, and action completion",
  general: "General-purpose — no specific role assigned",
};
