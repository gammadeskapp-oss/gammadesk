/**
 * A small fixed-window limiter for the unlock endpoint: at most N *failed*
 * attempts per IP per window.
 *
 * Only failures count, and a correct password clears the key — so a legitimate
 * owner who fumbles the password a few times and then gets it right is never
 * locked out, and a correct password is never refused for being the sixth
 * request. Brute force is still throttled: five wrong guesses in the window and
 * the IP is blocked until it resets.
 *
 * In-memory, so it is per-instance rather than global. On a serverless platform
 * a determined attacker spread across instances could exceed the nominal limit,
 * but each warm instance still throttles hard, and this is layered on top of a
 * constant-time password check rather than being the only defence. A shared
 * store (KV/Blob) would make it exact at the cost of a network round trip on
 * every attempt; that trade is not worth it for a single-owner tab.
 */

interface Window {
  failures: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export interface RateDecision {
  blocked: boolean;
  /** Seconds until the window resets, for a Retry-After header. */
  retryAfterS: number;
}

/**
 * Whether `key` is currently over its failure budget. A pure peek — it records
 * nothing, so calling it does not itself count against the limit.
 */
export function isRateLimited(
  key: string,
  limit = DEFAULT_LIMIT,
  now: number = Date.now(),
): RateDecision {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) return { blocked: false, retryAfterS: 0 };
  const retryAfterS = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  return { blocked: w.failures >= limit, retryAfterS };
}

/** Record one failed attempt against the key's window. */
export function recordFailure(
  key: string,
  windowMs = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): void {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { failures: 1, resetAt: now + windowMs });
    return;
  }
  w.failures += 1;
}

/** Clear a key's failures — called on a successful unlock. */
export function clearFailures(key: string): void {
  windows.delete(key);
}

/** Test-only: forget all recorded attempts. */
export function resetRateLimit(): void {
  windows.clear();
}
