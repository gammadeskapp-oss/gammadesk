import 'server-only';

/**
 * Tiny TTL cache with single-flight semantics.
 *
 * The single-flight part matters more than the caching: without it, five
 * simultaneous page loads on a cold server would each kick off their own
 * Polygon refresh and instantly blow through the free plan's 5 requests per
 * minute. With it, concurrent callers all await the same in-flight promise.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

interface Store {
  entries: Map<string, Entry<unknown>>;
  inFlight: Map<string, Promise<unknown>>;
}

const globalKey = Symbol.for('gammadesk.cache');
type GlobalWithStore = typeof globalThis & { [globalKey]?: Store };

function store(): Store {
  const g = globalThis as GlobalWithStore;
  if (!g[globalKey]) {
    g[globalKey] = { entries: new Map(), inFlight: new Map() };
  }
  return g[globalKey];
}

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  const { entries, inFlight } = store();

  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = await producer();
      entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Drop a cached entry so the next read refetches. Used by the refresh button. */
export function invalidate(key: string): void {
  store().entries.delete(key);
}

/** Milliseconds until `key` goes stale, or 0 if it is already stale/missing. */
export function ttlRemaining(key: string): number {
  const hit = store().entries.get(key);
  if (!hit) return 0;
  return Math.max(0, hit.expiresAt - Date.now());
}
