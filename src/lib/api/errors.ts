import { NextResponse } from "next/server";
import type { ApiErrorBody } from "@/lib/system/info";

/**
 * Every failure path goes through here so the client only ever receives a
 * code and a human-readable sentence — never a stack trace, env var name,
 * upstream URL or provider payload.
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  requestId?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json<ApiErrorBody>(
    { error: { code, message }, ...(requestId ? { requestId } : {}) },
    { status, headers: noStoreHeaders() },
  );
}

export function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store, no-cache, must-revalidate" };
}

/** Server-side only logging. Keeps diagnostics in platform logs. */
export function logServerError(scope: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { value: String(error) };
  console.error(`[ostra:${scope}]`, detail);
}
