import 'server-only';

import { barStore, digestStore } from '../rs/refresh';
import { SHARDS } from '../rs/universe';
import { ema } from '../ticker/indicators';

/**
 * The 20-day and 200-day averages for every name in the index.
 *
 * ## Why this is not just read off the digest
 *
 * The digest carries `ema20` and `ema200`, and reading them would be a two-line
 * function. They are *optional* fields, though, added after the digest format
 * was in use and deliberately not guarded by a schema bump — bumping the
 * schema rejects the stored **bar** documents too, which would throw away years
 * of price history to add a column. So a shard that has not been recomputed
 * since simply has no averages, and fills in whenever the nightly job next
 * walks that shard.
 *
 * For the movers list, which is what the fields were added for, that is a fine
 * trade: a name shows a dash until its shard comes round. For the scanner it is
 * not, and the difference is worth stating plainly. The 200-day average is the
 * *first stage of the funnel*. If it is missing the trend rule reads unknown,
 * unknown is not a pass, and every one of the 503 names falls out at the first
 * step — which is precisely the dead page this whole rebuild exists to fix,
 * reintroduced by a storage detail rather than by anything about the market.
 * On the shards stored today that is not hypothetical: none of the 503 entries
 * has either average.
 *
 * So the averages are computed here, from the bar shards, which hold the full
 * close history and are already stored. It costs no upstream request — the
 * same reason the whole index can be scored at all — and it means the scanner
 * cannot be silently emptied by a column that has not been backfilled yet.
 *
 * A digest that *does* carry the averages is preferred, because it is the same
 * number computed by the same function on the same series and it saves reading
 * a large document. This is a fallback, not a replacement.
 */

export interface MovingAverages {
  ema20: number | null;
  ema200: number | null;
}

const SHORT = 20;
const LONG = 200;

/** Last non-null value of a series. */
function last(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

export async function readMovingAverages(): Promise<{
  bySymbol: Map<string, MovingAverages>;
  /** How many symbols came from the digest rather than being recomputed. */
  fromDigest: number;
  /** How many were computed from the bar history. */
  computed: number;
  /** Symbols with too little history for either average. */
  missing: number;
}> {
  const bySymbol = new Map<string, MovingAverages>();
  let fromDigest = 0;
  let computed = 0;
  let missing = 0;

  const digests = await Promise.all(
    Array.from({ length: SHARDS }, (_, shard) =>
      digestStore(shard).read().catch(() => null),
    ),
  );

  /** Symbols the digest could not answer for, per shard. */
  const needBars: Array<Set<string>> = [];

  digests.forEach((doc, shard) => {
    const need = new Set<string>();
    for (const entry of doc?.entries ?? []) {
      const ema20 = entry.ema20 ?? null;
      const ema200 = entry.ema200 ?? null;
      if (ema200 !== null) {
        bySymbol.set(entry.symbol, { ema20, ema200 });
        fromDigest += 1;
      } else {
        need.add(entry.symbol);
      }
    }
    needBars[shard] = need;
  });

  /*
   * Bar shards are read only for the shards that actually need them. On a
   * fully-refreshed store that is none of them and this costs one skipped
   * branch; on the store as it stands it is all four, which is the case worth
   * being correct in.
   */
  await Promise.all(
    needBars.map(async (need, shard) => {
      if (need.size === 0) return;

      const doc = await barStore(shard).read().catch(() => null);
      if (!doc) {
        for (const symbol of need) {
          bySymbol.set(symbol, { ema20: null, ema200: null });
          missing += 1;
        }
        return;
      }

      for (const symbol of need) {
        // `null` marks a session the symbol did not trade, or any date before
        // it listed. Dropped rather than carried forward: an average taken
        // over a series with holes in it is not the average it claims to be.
        const closes = (doc.closes[symbol] ?? []).filter(
          (c): c is number => c !== null && Number.isFinite(c),
        );

        const ema20 = closes.length >= SHORT ? last(ema(closes, SHORT)) : null;
        const ema200 = closes.length >= LONG ? last(ema(closes, LONG)) : null;

        bySymbol.set(symbol, { ema20, ema200 });
        if (ema200 === null) missing += 1;
        else computed += 1;
      }
    }),
  );

  return { bySymbol, fromDigest, computed, missing };
}
