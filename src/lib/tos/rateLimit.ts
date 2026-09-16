/**
 * A small fixed-window rate limiter for the unlock endpoint: at most N attempts
 * per IP per window.
 *
 * In-memory, so it is per-instance rather than global. On a serverless platform
 * a determined attacker spread across instances could exceed the nominal limit,
 * but each warm instance still throttles brute force hard, and this is layered
 * on top of a constant-time password check rather than being the only defence.
 * A shared store (KV/Blob) would make it exact at the cost of a network round
 * trip on every attempt; that trade is not worth it for a single-owner tab.
 */

interface Window {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, Window>();

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window resets, for a Retry-After header. */
  retryAfterS: number;
}

/**
 * Record an attempt from `key` and decide whether it is allowed.
 *
 * @param limit    Attempts permitted per window.
 * @param windowMs Window length in milliseconds.
 * @param now      Injectable clock, for tests.
 */
export function rateLimit(
  key: string,
  limit = 5,
  windowMs = 15 * 60 * 1000,
  now: number = Date.now(),
): RateDecision {
  const existing = attempts.get(key);

  if (!existing || now >= existing.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterS: 0 };
  }

  existing.count += 1;
  const retryAfterS = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { allowed: existing.count <= limit, retryAfterS };
}

/** Test-only: forget all recorded attempts. */
export function resetRateLimit(): void {
  attempts.clear();
}
