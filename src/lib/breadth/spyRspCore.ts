/**
 * SPY vs RSP — the pure logic: the verdict, the wording and the staleness rule.
 *
 * Kept free of `server-only` and of any fetch so it can be unit-tested directly
 * (see `scripts/verify-spy-rsp.mjs`), the same split `compute.ts` has from the
 * IO in `index.ts`. The fetch and the cache live in `spyRsp.ts`, which
 * re-exports everything here.
 *
 * SPY holds the S&P 500 weighted by company size, so the largest handful of
 * companies drive most of its move. RSP — the Invesco S&P 500 Equal Weight ETF
 * — holds the same five hundred companies with every one counting the same, so
 * it follows the *average* company. The gap between the two days' changes
 * separates "the market moved" from "a few giants moved"; the one-month ratio
 * says which group has been winning over the longer run. Context only — this
 * feeds no score, verdict or forecast anywhere.
 */

/**
 * The flat band for the day's gap, in percentage points.
 *
 * Wider than the breadth shape's `FLAT_BAND_PCT` (0.15) on purpose: this gates
 * a plain-English verdict a reader acts on, so a gap has to be clearly one-sided
 * — a third of a percent — before the wording commits to "narrow" or "leading".
 */
export const GAP_BAND_PCT = 0.3;

/** Trading days in the one-month look-back for the RSP/SPY ratio. */
export const MONTH_LOOKBACK_SESSIONS = 21;

/**
 * How old the day's reading may be, in minutes, before a live page hides it.
 *
 * The breadth cron refreshes this every minute the market is open, so anything
 * much older than a few ticks means the refresh has stopped and the number on
 * screen is no longer live. After the close the final reading is the day's
 * close, not a stale live quote — callers pass `marketOpen: false` and it is
 * kept. See `isSpyRspStale`.
 */
export const STALE_AFTER_MINUTES = 15;

export type SpyRspVerdict =
  | 'broad-up'
  | 'narrow'
  | 'avg-leading'
  | 'broad-down'
  | 'big-lagging'
  | 'narrow-down'
  | 'even';

/** Plain-English line per verdict. No buy/sell wording, ever. */
export const SPY_RSP_VERDICT_LINE: Record<SpyRspVerdict, string> = {
  'broad-up': 'Broad move — most stocks joining in',
  narrow: 'Narrow — big stocks carrying it',
  'avg-leading': 'Average stock leading',
  'broad-down': 'Broad selling',
  'big-lagging': 'Big stocks lagging, the rest holding up',
  'narrow-down': 'Narrow — a few big stocks holding the line',
  even: 'Moving together',
};

/** One short word for the compact contexts (scanner header, X tags). */
export const SPY_RSP_VERDICT_TAG: Record<SpyRspVerdict, string> = {
  'broad-up': 'broad',
  narrow: 'narrow',
  'avg-leading': 'avg leading',
  'broad-down': 'broad selling',
  'big-lagging': 'big lagging',
  'narrow-down': 'narrow',
  even: 'even',
};

export interface SpyRspReading {
  /** SPY change since yesterday's close, in percent. */
  spyPct: number;
  /** RSP change since yesterday's close, in percent. */
  rspPct: number;
  /** `rspPct - spyPct`, in percentage points. Negative: the average stock lags. */
  gapPct: number;
  /**
   * Percent change in the RSP/SPY ratio versus ~21 sessions ago, or null when
   * the month of daily bars could not be read. Positive: the average stock has
   * been winning over the month.
   */
  monthRatioChangePct: number | null;
  /** A short RSP/SPY ratio series for the tiny line, oldest first, or null. */
  monthRatioSeries: number[] | null;
  verdict: SpyRspVerdict;
  /** The plain-English line for the verdict. */
  line: string;
  /** When this reading was taken, ISO-8601 UTC — the real data time. */
  at: string;
}

/**
 * The verdict from the day's two changes. Pure, so every case is testable.
 *
 * Ordered so the five named cases read exactly as specified, with honest
 * wording for the two that fall outside them (a down tape where the average
 * stock is doing worse, and a dead-flat tape).
 */
export function spyRspVerdict(spyPct: number, rspPct: number): SpyRspVerdict {
  const gap = rspPct - spyPct;

  // Divergence: index down while the average stock is up (or vice versa). The
  // clearest "it is only the giants" signals there are, so they go first.
  if (spyPct < 0 && rspPct > 0) return 'big-lagging';
  if (spyPct > 0 && rspPct < 0) return 'narrow';

  // Same direction (or one leg flat): the gap decides.
  if (gap > GAP_BAND_PCT) return 'avg-leading';
  if (gap < -GAP_BAND_PCT) {
    // Average stock clearly behind. On an up tape that is the giants carrying
    // it; on a down tape it is the giants holding the line.
    return spyPct > 0 ? 'narrow' : 'narrow-down';
  }

  // Gap inside the flat band — a broad move in whichever direction the tape is.
  if (spyPct > 0 && rspPct > 0) return 'broad-up';
  if (spyPct < 0 && rspPct < 0) return 'broad-down';
  return 'even';
}

/** Assemble a reading from its parts. Pure. */
export function buildSpyRspReading(input: {
  spyPct: number;
  rspPct: number;
  monthRatioChangePct: number | null;
  monthRatioSeries: number[] | null;
  at: string;
}): SpyRspReading {
  const verdict = spyRspVerdict(input.spyPct, input.rspPct);
  return {
    spyPct: input.spyPct,
    rspPct: input.rspPct,
    gapPct: input.rspPct - input.spyPct,
    monthRatioChangePct: input.monthRatioChangePct,
    monthRatioSeries: input.monthRatioSeries,
    verdict,
    line: SPY_RSP_VERDICT_LINE[verdict],
    at: input.at,
  };
}

/**
 * Whether a stored reading is too old to show on a live page.
 *
 * While the market is open the cron keeps this fresh to the minute, so an aged
 * reading means the refresh has stalled and showing it would be a quiet lie
 * about what is known now — hidden instead. Once the market is closed the last
 * reading is the day's close and is kept.
 */
export function isSpyRspStale(
  reading: SpyRspReading | null,
  opts: { marketOpen: boolean; now?: Date },
): boolean {
  if (!reading) return true;
  if (!opts.marketOpen) return false;
  const ageMin = ((opts.now ?? new Date()).getTime() - Date.parse(reading.at)) / 60_000;
  return !Number.isFinite(ageMin) || ageMin > STALE_AFTER_MINUTES;
}

function arrow(pct: number): string {
  if (pct > 0.05) return '▲';
  if (pct < -0.05) return '▼';
  return '▬';
}

function fmtPct(pct: number): string {
  return `${Math.abs(pct).toFixed(1)}%`;
}

/**
 * A compact "SPY ▲0.6% · RSP ▼0.2% → Narrow — big stocks carrying it" line,
 * the shared wording for the dashboard card, the daily page and the brief.
 */
export function spyRspSummaryLine(r: SpyRspReading): string {
  return `SPY ${arrow(r.spyPct)}${fmtPct(r.spyPct)} · RSP ${arrow(r.rspPct)}${fmtPct(r.rspPct)} → ${r.line}`;
}

/** "Big vs avg stock: SPY ▲ · RSP ▼ (narrow)" — the terse form for an X post. */
export function spyRspPostLine(r: SpyRspReading): string {
  return `Big vs avg stock: SPY ${arrow(r.spyPct)} · RSP ${arrow(r.rspPct)} (${SPY_RSP_VERDICT_TAG[r.verdict]})`;
}
