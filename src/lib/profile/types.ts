/**
 * Shared by the volume-profile maths and the chart overlay that draws it.
 *
 * Deliberately free of `server-only` and of any import that pulls it in: the
 * profile is computed in the browser from bars the chart already holds.
 */

/**
 * The only three fields the profile needs from a bar.
 *
 * Structurally satisfied by `ChartBar` from `@/lib/bars/types`, so callers can
 * pass their bars straight through without mapping.
 */
export interface ProfileBar {
  h: number;
  l: number;
  v: number;
}

/** One price bucket and the volume attributed to it. */
export interface ProfileBucket {
  priceLow: number;
  priceHigh: number;
  volume: number;
}

/**
 * The value area: the contiguous run of buckets around the POC holding
 * `targetShare` of total volume.
 */
export interface ValueArea {
  /** Index of the lowest bucket in the area, inclusive. */
  fromIndex: number;
  /** Index of the highest bucket in the area, inclusive. */
  toIndex: number;
  /** `buckets[fromIndex].priceLow` — the value area low, VAL. */
  low: number;
  /** `buckets[toIndex].priceHigh` — the value area high, VAH. */
  high: number;
  /** Volume actually enclosed, which meets or exceeds the target. */
  volume: number;
}

export interface VolumeProfile {
  buckets: ProfileBucket[];
  /** Bottom of the lowest bucket. */
  priceLow: number;
  /** Top of the highest bucket. */
  priceHigh: number;
  /** Sum of every bucket's volume, and of every input bar's volume. */
  totalVolume: number;
  /** The single heaviest bucket's volume, for scaling the drawing. */
  maxBucketVolume: number;
  /** Index of the point of control — the heaviest bucket. Null when empty. */
  pocIndex: number | null;
  /** Null when there is no volume to enclose. */
  valueArea: ValueArea | null;
}
