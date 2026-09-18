/**
 * Minimal fixed-window rate limiter for the chat endpoint.
 *
 * Scoped to a single server instance (Vercel functions are per-instance), so
 * it is a blunt instrument: enough to stop a runaway client or a naive script,
 * not a security boundary. The `RateLimiter` shape is the seam a Redis-backed
 * implementation slots into later.
 */
export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 5_000;

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowSeconds: number) {
    this.limit = Math.max(1, limit);
    this.windowMs = Math.max(1, windowSeconds) * 1_000;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    this.prune(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true, limit: this.limit, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    const remaining = Math.max(0, this.limit - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));

    return {
      ok: bucket.count <= this.limit,
      limit: this.limit,
      remaining,
      retryAfterSeconds: bucket.count <= this.limit ? 0 : retryAfterSeconds,
    };
  }

  private prune(now: number): void {
    if (this.buckets.size < MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

let limiter: InMemoryRateLimiter | null = null;

export function getRateLimiter(): InMemoryRateLimiter {
  if (!limiter) {
    const max = Number.parseInt(process.env.OSTRA_RATE_LIMIT_MAX ?? "", 10);
    const windowSeconds = Number.parseInt(process.env.OSTRA_RATE_LIMIT_WINDOW ?? "", 10);
    limiter = new InMemoryRateLimiter(
      Number.isFinite(max) && max > 0 ? max : 30,
      Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60,
    );
  }
  return limiter;
}

/** Best-effort client identity for rate limiting. */
export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
