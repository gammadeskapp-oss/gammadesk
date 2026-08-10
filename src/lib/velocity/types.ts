/** One strike's dollar gamma, stored compactly — these run to thousands of rows. */
export interface StrikeGamma {
  /** ticker */
  t: string;
  /** expiration, `YYYY-MM-DD` */
  e: string;
  /** strike */
  k: number;
  /** dollar gamma exposure */
  g: number;
}

export interface VelocitySnapshot {
  /**
   * The CHAIN's trading day, not the calendar day it was captured on.
   *
   * Cboe keeps serving Friday's book all weekend, so keying on the calendar
   * date would store Saturday and Sunday as fresh snapshots and then report a
   * day of zero change. Keying on the quote date makes a repeat capture a
   * no-op instead.
   */
  date: string;
  capturedAt: string;
  spots: Record<string, number>;
  strikes: StrikeGamma[];
  symbols: string[];
  failures: string[];
}

export interface StoredVelocity {
  snapshots: VelocitySnapshot[];
}

export type VelocityTag = 'GREW' | 'SHRANK' | 'NEW';

export interface VelocityRow {
  symbol: string;
  expiration: string;
  expiryLabel: string;
  strike: number;
  was: number;
  now: number;
  /** Signed dollar change. */
  change: number;
  /** Null when there was nothing to compare against. */
  changePct: number | null;
  tag: VelocityTag;
  spot: number;
  distancePct: number;
}

export interface VelocityResult {
  rows: VelocityRow[];
  /** Newest snapshot's trading day. */
  currentDate: string;
  /** The day it is compared against. */
  previousDate: string | null;
  capturedAt: string;
  symbols: number;
  snapshotsStored: number;
  totalCompared: number;
  notes: string[];
}
