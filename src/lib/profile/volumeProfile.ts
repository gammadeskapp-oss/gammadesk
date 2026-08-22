import type { ProfileBar, ProfileBucket, ValueArea, VolumeProfile } from './types';

/**
 * Volume by price level, built from OHLCV bars.
 *
 * # What this is not
 *
 * A real volume profile is built from trades: every print carries the price it
 * happened at, so volume lands where it actually traded. We do not have trades
 * — we have bars. A bar says 3.1M shares changed hands somewhere between 412.10
 * and 415.60, and says nothing whatsoever about where inside that range.
 *
 * So the range has to be filled in by a rule, and every such rule is invented.
 * This module uses the plainest one: spread each bar's volume *uniformly*
 * across its high-low range, weighting each bucket by how much of the bar's
 * range it covers. That is a defensible default and it is still a guess. The
 * shape it produces is driven by which prices bars overlapped, not by where
 * trading concentrated within any one bar.
 *
 * Two consequences worth stating plainly, because they look like signal:
 *
 *   - A wide bar smears its volume thin across many buckets; a narrow bar with
 *     the same volume piles it into one. On a coarse timeframe the profile
 *     therefore reads as much as a map of bar ranges as of traded volume.
 *   - The POC is the heaviest bucket under this rule. On a fine timeframe,
 *     where bars are narrow and the rule has little room to invent anything,
 *     it converges on the real thing. On daily bars it can sit at a price
 *     nobody traded much at.
 *
 * None of that can be fixed by a cleverer spreading rule, because the
 * information is not in the input. The honest fix is tick data, which this
 * project does not have and is not adding.
 *
 * There is deliberately no delta and no bid/ask split. Bars cannot distinguish
 * buying from selling, and a field that looks real but is not is worse than an
 * absent one.
 */

/** Buckets across the range when the caller does not say. */
export const DEFAULT_BUCKET_COUNT = 50;

/** Share of total volume the value area encloses, by long convention. */
export const DEFAULT_VALUE_AREA_SHARE = 0.7;

export interface ProfileOptions {
  /** Price buckets across the whole range. Clamped to at least 1. */
  bucketCount?: number;
  /** Fraction of total volume the value area must contain. */
  valueAreaShare?: number;
}

/** Empty in, empty out — callers render nothing rather than special-case null. */
function emptyProfile(): VolumeProfile {
  return {
    buckets: [],
    priceLow: 0,
    priceHigh: 0,
    totalVolume: 0,
    maxBucketVolume: 0,
    pocIndex: null,
    valueArea: null,
  };
}

/**
 * Distribute `bars` across `bucketCount` price buckets spanning their combined
 * high-low range.
 *
 * Buckets are equal width and ascending, `buckets[0]` being the lowest price.
 * Each bar contributes to every bucket its range overlaps, in proportion to the
 * overlap — see the module note on why that rule is an assumption rather than a
 * measurement.
 *
 * Bars with no range (high === low) are point events: their whole volume goes
 * to the single bucket containing that price. Bars with non-positive volume
 * still widen the price range, which is what the candles show, but add nothing.
 */
export function buildVolumeProfile(
  bars: readonly ProfileBar[],
  options: ProfileOptions = {},
): VolumeProfile {
  const bucketCount = Math.max(
    1,
    Math.floor(options.bucketCount ?? DEFAULT_BUCKET_COUNT),
  );

  const usable = bars.filter(
    (bar) =>
      Number.isFinite(bar.h) && Number.isFinite(bar.l) && Number.isFinite(bar.v),
  );
  if (usable.length === 0) return emptyProfile();

  let priceLow = Infinity;
  let priceHigh = -Infinity;
  for (const bar of usable) {
    // Tolerate an inverted bar rather than producing a negative-width range.
    const low = Math.min(bar.l, bar.h);
    const high = Math.max(bar.l, bar.h);
    if (low < priceLow) priceLow = low;
    if (high > priceHigh) priceHigh = high;
  }

  /*
   * Every bar at one price. Splitting a zero-wide range into 50 buckets would
   * produce 50 identical prices and an arbitrary POC among them; one bucket is
   * the honest description of what happened.
   */
  if (priceHigh <= priceLow) {
    const volume = usable.reduce((sum, bar) => sum + Math.max(0, bar.v), 0);
    return {
      buckets: [{ priceLow, priceHigh: priceLow, volume }],
      priceLow,
      priceHigh: priceLow,
      totalVolume: volume,
      maxBucketVolume: volume,
      pocIndex: 0,
      valueArea:
        volume > 0
          ? { fromIndex: 0, toIndex: 0, low: priceLow, high: priceLow, volume }
          : null,
    };
  }

  const width = (priceHigh - priceLow) / bucketCount;
  const volumes = new Array<number>(bucketCount).fill(0);

  /** Which bucket a price falls in, with the top of the range clamped inward. */
  const bucketOf = (price: number): number => {
    const index = Math.floor((price - priceLow) / width);
    return Math.min(bucketCount - 1, Math.max(0, index));
  };

  /** Top edge of a bucket, the last one pinned so rounding cannot lose volume. */
  const topOf = (index: number): number =>
    index === bucketCount - 1 ? priceHigh : priceLow + (index + 1) * width;

  for (const bar of usable) {
    const volume = Math.max(0, bar.v);
    if (volume === 0) continue;

    const low = Math.min(bar.l, bar.h);
    const high = Math.max(bar.l, bar.h);

    if (high <= low) {
      volumes[bucketOf(low)] += volume;
      continue;
    }

    const first = bucketOf(low);
    const last = bucketOf(high);

    if (first === last) {
      volumes[first] += volume;
      continue;
    }

    const span = high - low;
    for (let i = first; i <= last; i += 1) {
      const overlap =
        Math.min(high, topOf(i)) - Math.max(low, priceLow + i * width);
      if (overlap > 0) volumes[i] += volume * (overlap / span);
    }
  }

  const buckets: ProfileBucket[] = volumes.map((volume, i) => ({
    priceLow: priceLow + i * width,
    priceHigh: topOf(i),
    volume,
  }));

  let totalVolume = 0;
  let maxBucketVolume = 0;
  let pocIndex: number | null = null;
  for (let i = 0; i < buckets.length; i += 1) {
    const volume = buckets[i].volume;
    totalVolume += volume;
    // Strictly greater, so a tie keeps the lower price. An arbitrary choice,
    // but a fixed one, and exact ties only arise on synthetic data.
    if (volume > maxBucketVolume) {
      maxBucketVolume = volume;
      pocIndex = i;
    }
  }

  if (pocIndex === null || totalVolume <= 0) {
    return {
      buckets,
      priceLow,
      priceHigh,
      totalVolume: 0,
      maxBucketVolume: 0,
      pocIndex: null,
      valueArea: null,
    };
  }

  return {
    buckets,
    priceLow,
    priceHigh,
    totalVolume,
    maxBucketVolume,
    pocIndex,
    valueArea: computeValueArea(
      buckets,
      pocIndex,
      totalVolume,
      options.valueAreaShare ?? DEFAULT_VALUE_AREA_SHARE,
    ),
  };
}

/**
 * Grow a contiguous range outward from the POC until it holds `share` of total
 * volume, taking the heavier of the two adjoining buckets at each step.
 *
 * A tie between the two neighbours takes the upper one. When one side runs out
 * the other is taken unconditionally, so the loop always ends with either the
 * target met or every bucket enclosed.
 */
function computeValueArea(
  buckets: readonly ProfileBucket[],
  pocIndex: number,
  totalVolume: number,
  share: number,
): ValueArea {
  const target = totalVolume * Math.min(1, Math.max(0, share));
  /*
   * A running sum of floats will not land exactly on a target reached by
   * multiplication. Being one ulp short would pull in a whole extra bucket and
   * quietly widen every value area, so the comparison carries a tolerance —
   * scaled to the total, so it stays a rounding allowance at any volume.
   */
  const epsilon = totalVolume * 1e-12;

  let from = pocIndex;
  let to = pocIndex;
  let volume = buckets[pocIndex].volume;

  while (volume + epsilon < target && (from > 0 || to < buckets.length - 1)) {
    const below = from > 0 ? buckets[from - 1].volume : -1;
    const above = to < buckets.length - 1 ? buckets[to + 1].volume : -1;

    if (above >= below) {
      to += 1;
      volume += buckets[to].volume;
    } else {
      from -= 1;
      volume += buckets[from].volume;
    }
  }

  return {
    fromIndex: from,
    toIndex: to,
    low: buckets[from].priceLow,
    high: buckets[to].priceHigh,
    volume,
  };
}
