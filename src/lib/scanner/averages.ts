import 'server-only';

import { barStore, digestStore } from '../rs/refresh';
import { SHARDS } from '../rs/universe';
import { ema } from '../ticker/indicators';

/**
 * The 20-, 50- and 200-day averages and the daily VWAP, for every name in the
 * index.
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
  /**
   * The 50-day average.
   *
   * The digest now carries this alongside 20 and 200 — it was added for the
   * swing candidate engine, which needs the full stack — so it is preferred
   * from there where a refreshed shard has it, exactly like the other two. It
   * is still computed here from the bar history as the fallback, because the
   * field is unversioned and a shard stored before it was added has no 50-day
   * average until the nightly job next walks it. That fallback costs the bar
   * read that is happening anyway, so the whole index has a 50-day average from
   * the first run rather than filling in a shard a night.
   */
  ema50: number | null;
  ema200: number | null;
  /**
   * Volume-weighted average price over the last 20 sessions.
   *
   * ## This is a daily VWAP, and it is not the intraday one
   *
   * Worth being exact about, because the two get called the same thing. A
   * trading-platform VWAP is anchored at the opening bell and computed from
   * intraday bars; this is sum(close x volume) / sum(volume) over the last
   * twenty *daily* bars. It answers "is price above the level most of the
   * recent shares actually changed hands at", which is the question the score
   * uses it for.
   *
   * It is not the session VWAP because the session VWAP cannot be had for 503
   * names without 503 intraday bar requests every morning, and the whole
   * reason the index can be scored at all is that this file touches no
   * upstream at all. A number that is nearly right and costs nothing beats a
   * number that is exactly right and empties the page whenever the intraday
   * feed is slow. The page and the tooltip both say which one this is.
   */
  vwap20: number | null;
}

const SHORT = 20;
const MID = 50;
const LONG = 200;

/** Sessions the daily VWAP is computed over. */
const VWAP_WINDOW = 20;

/** Last non-null value of a series. */
function last(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Volume-weighted average close over the last `VWAP_WINDOW` sessions.
 *
 * Sessions where either leg is missing are dropped in pairs, so the weights
 * and the prices always describe the same days. Null when fewer than the full
 * window survives — a VWAP over nine of twenty sessions is a different number
 * wearing the same label.
 */
function vwap(
  closes: (number | null)[],
  volumes: (number | null)[] | undefined,
): number | null {
  if (!volumes) return null;

  let priceVolume = 0;
  let volume = 0;
  let used = 0;

  for (let i = closes.length - 1; i >= 0 && used < VWAP_WINDOW; i -= 1) {
    const close = closes[i];
    const size = volumes[i];
    if (close === null || size === null) continue;
    if (!Number.isFinite(close) || !Number.isFinite(size) || size <= 0) continue;
    priceVolume += close * size;
    volume += size;
    used += 1;
  }

  if (used < VWAP_WINDOW || !(volume > 0)) return null;
  return priceVolume / volume;
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

  /** Symbols per shard, all of which need their bars read — see below. */
  const needBars: Array<Set<string>> = [];
  /** What the digest already knew, preferred over a recomputation. */
  const digestAverages = new Map<
    string,
    { ema20: number | null; ema50: number | null; ema200: number | null }
  >();

  digests.forEach((doc, shard) => {
    const need = new Set<string>();
    /*
     * Every symbol needs its bars now, whatever the digest holds.
     *
     * The digest can answer for the 20 and the 200 and can never answer for
     * the 50 or the VWAP, and a row carrying two of the four would report the
     * trend sub-score over half its inputs while looking exactly like a row
     * that had all of them. So the digest values are kept where they exist —
     * they are the same function on the same closes, and preferring them keeps
     * this page and /movers from disagreeing about the same stock — and the
     * shard is read regardless to fill in the rest.
     */
    for (const entry of doc?.entries ?? []) {
      need.add(entry.symbol);
      if ((entry.ema200 ?? null) !== null) fromDigest += 1;
      digestAverages.set(entry.symbol, {
        ema20: entry.ema20 ?? null,
        ema50: entry.ema50 ?? null,
        ema200: entry.ema200 ?? null,
      });
    }
    needBars[shard] = need;
  });

  /*
   * All four bar shards, every run. It used to be only the shards the digest
   * could not answer for; the 50-day average and the VWAP are not in the
   * digest and never will be, so there is no longer a case where the bars can
   * be skipped. The read is of stored documents and costs no upstream request,
   * which is the property that matters.
   */
  await Promise.all(
    needBars.map(async (need, shard) => {
      if (need.size === 0) return;

      const doc = await barStore(shard).read().catch(() => null);
      if (!doc) {
        for (const symbol of need) {
          const known = digestAverages.get(symbol);
          bySymbol.set(symbol, {
            ema20: known?.ema20 ?? null,
            ema50: known?.ema50 ?? null,
            ema200: known?.ema200 ?? null,
            vwap20: null,
          });
          if ((known?.ema200 ?? null) === null) missing += 1;
        }
        return;
      }

      for (const symbol of need) {
        // `null` marks a session the symbol did not trade, or any date before
        // it listed. Dropped rather than carried forward: an average taken
        // over a series with holes in it is not the average it claims to be.
        const rawCloses = doc.closes[symbol] ?? [];
        const closes = rawCloses.filter(
          (c): c is number => c !== null && Number.isFinite(c),
        );

        const known = digestAverages.get(symbol);
        const ema20 = known?.ema20 ?? (closes.length >= SHORT ? last(ema(closes, SHORT)) : null);
        const ema50 = known?.ema50 ?? (closes.length >= MID ? last(ema(closes, MID)) : null);
        const ema200 =
          known?.ema200 ?? (closes.length >= LONG ? last(ema(closes, LONG)) : null);

        /*
         * The VWAP reads the unfiltered series, unlike the averages above.
         * Closes and volumes are stored against one shared date index, so
         * compacting one and not the other would multiply a Tuesday's price by
         * a Wednesday's volume.
         */
        bySymbol.set(symbol, {
          ema20,
          ema50,
          ema200,
          vwap20: vwap(rawCloses, doc.volumes[symbol]),
        });

        if (ema200 === null) missing += 1;
        else if ((known?.ema200 ?? null) === null) computed += 1;
      }
    }),
  );

  return { bySymbol, fromDigest, computed, missing };
}
