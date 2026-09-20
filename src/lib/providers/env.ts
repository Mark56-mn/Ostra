/**
 * Environment reading helpers shared by the provider modules.
 *
 * Everything that reads process.env inside the provider layer goes through
 * these so trimming/blank handling stays consistent.
 */

export function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function readTemperature(): number {
  const raw = readEnv("MODEL_TEMPERATURE");
  if (!raw) return 0.7;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0.7;
  return Math.min(2, Math.max(0, Math.round(parsed * 100) / 100));
}
