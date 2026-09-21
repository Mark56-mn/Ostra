/**
 * Tool input validation (Stage 2).
 *
 * Converts the registry's JSON Schema into a zod schema per request and
 * validates client-supplied arguments. Rejects anything the registry does
 * not describe — the client never defines what a tool accepts.
 */
import { z } from "zod";

export type ToolValidationResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; code: "invalid_schema" | "invalid_args"; message: string };

function schemaToZod(schema: unknown): z.ZodType | null {
  if (typeof schema !== "object" || schema === null) return null;
  const s = schema as Record<string, unknown>;
  if (s.type !== "object") return null;

  const properties = (s.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(s.required) ? (s.required as unknown[]).filter((v): v is string => typeof v === "string") : [];

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, rawProp] of Object.entries(properties)) {
    if (typeof rawProp !== "object" || rawProp === null) return null;
    const prop = rawProp as Record<string, unknown>;
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case "string":
        field = prop.description ? z.string().describe(String(prop.description)) : z.string();
        break;
      case "number":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "object": {
        const nested = schemaToZod(rawProp);
        if (!nested) return null;
        field = nested;
        break;
      }
      default:
        // Unsupported property types make the whole tool unvalidatable —
        // safer to refuse than to pass unvalidated data onward.
        return null;
    }
    shape[key] = required.includes(key) ? field : field.optional();
  }

  const base = z.object(shape).strict();
  return base;
}

/**
 * Validate tool arguments against the registry's declared input schema.
 */
export function validateToolArgs(toolId: string, schema: unknown, args: unknown): ToolValidationResult {
  const zodSchema = schemaToZod(schema);
  if (!zodSchema) {
    return { ok: false, code: "invalid_schema", message: `Tool ${toolId} has a schema Ostra cannot enforce.` };
  }

  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, code: "invalid_args", message: "Tool arguments must be a JSON object." };
  }

  const parsed = zodSchema.safeParse(args);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? `${first.path.map(String).join(".")}: ` : "";
    return {
      ok: false,
      code: "invalid_args",
      message: `Tool arguments failed validation — ${path}${first?.message ?? "invalid input"}.`,
    };
  }

  return { ok: true, args: parsed.data as Record<string, unknown> };
}
