import 'server-only';

/**
 * Sliding-window rate limiter sized for Polygon's free plan (5 requests per
 * minute). It records the timestamp of every request and, when the window is
 * full, sleeps until the oldest one ages out.
 *
 * This is per-process. On Vercel a cold lambda starts with an empty window, so
 * it is a safety net rather than the primary defence — the real protection is
 * the 30-minute response cache plus single-flight de-duplication in cache.ts.
 */
export class SlidingWindowLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Resolves once it is safe to issue another request. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.hits.length > 0 && now - this.hits[0] >= this.windowMs) {
        this.hits.shift();
      }
      if (this.hits.length < this.max) {
        this.hits.push(now);
        return;
      }
      const waitMs = this.windowMs - (now - this.hits[0]) + 25;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /** Requests issued inside the current window. */
  get used(): number {
    const now = Date.now();
    return this.hits.filter((t) => now - t < this.windowMs).length;
  }
}

const globalKey = Symbol.for('gammadesk.polygon.limiter');
type GlobalWithLimiter = typeof globalThis & {
  [globalKey]?: SlidingWindowLimiter;
};

/**
 * Shared across hot-reloads in dev so the limiter isn't reset on every edit.
 */
export function polygonLimiter(max: number): SlidingWindowLimiter {
  const g = globalThis as GlobalWithLimiter;
  if (!g[globalKey]) {
    g[globalKey] = new SlidingWindowLimiter(max, 60_000);
  }
  return g[globalKey];
}
