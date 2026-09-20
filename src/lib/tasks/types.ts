/**
 * Task configuration types — Stage 2 Model Control Center.
 *
 * A task *configuration* describes which allowlisted models a future task
 * runs on and with which roles. Stage 2 ships the types, validation and the
 * persistence seam only — there is deliberately no queue, worker or
 * autonomous execution here (those are Stage 3/4 and must not be faked).
 */
import { z } from "zod";
import { MODEL_ROLES } from "@/lib/model-selection/tasks-types";

/** A single model assignment within a task. */
export const ModelAssignmentSchema = z.object({
  provider: z.string().min(1).max(50),
  model: z.string().min(1).max(200),
  role: z.enum(MODEL_ROLES).default("general"),
});

export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>;

/** Task configuration — what models are assigned and how. */
export const TaskConfigSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  models: z
    .array(ModelAssignmentSchema)
    .min(1, "At least one model must be assigned")
    .max(5, "At most 5 models can be assigned to a single task"),
  maxSteps: z.number().int().min(1).max(100).default(10),
  timeoutMs: z.number().int().min(5_000).max(600_000).default(120_000),
});

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

export function validateTaskConfig(
  input: unknown,
): { valid: true; data: TaskConfig } | { valid: false; errors: string[] } {
  const result = TaskConfigSchema.safeParse(input);
  if (result.success) return { valid: true, data: result.data };
  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}
