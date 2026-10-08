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
 * — more than a third of a percent — before the wording commits to "narrow",
 * "leading" or "lagging".
 */
export const GAP_BAND_PCT = 0.3;

/**
 * The quiet band, in percent. When *both* legs sit inside ±0.3% and there is no
 * real gap between them, nothing happened worth a verdict — the honest word is
 * "quiet", not "broad selling" off two readings a whisker below zero.
 */
export const QUIET_BAND_PCT = 0.3;

/**
 * The broad band, in percent. "Broad move" / "Broad selling" is only said when
 * *both* legs are clearly beyond ±0.5% in the same direction — a real, wide
 * session, not a drift. Between the quiet and broad bands the tape is "mixed".
 */
export const BROAD_BAND_PCT = 0.5;

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
  | 'quiet'
  | 'mixed';

/** Plain-English line per verdict. No buy/sell wording, ever. */
export const SPY_RSP_VERDICT_LINE: Record<SpyRspVerdict, string> = {
  'broad-up': 'Broad move — most stocks joining in',
  narrow: 'Narrow — big stocks carrying it',
  'avg-leading': 'Average stock leading',
  'broad-down': 'Broad selling',
  'big-lagging': 'Big stocks lagging, the rest holding up',
  'narrow-down': 'Narrow — a few big stocks holding the line',
  quiet: 'Quiet day, no clear difference',
  mixed: 'Mixed day',
};

/** One short word for the compact contexts (scanner header, X tags). */
export const SPY_RSP_VERDICT_TAG: Record<SpyRspVerdict, string> = {
  'broad-up': 'broad',
  narrow: 'narrow',
  'avg-leading': 'avg leading',
  'broad-down': 'broad selling',
  'big-lagging': 'big lagging',
  'narrow-down': 'narrow',
  quiet: 'quiet',
  mixed: 'mixed',
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
  /**
   * The verdict shown everywhere. This is the *settled* verdict after the
   * anti-flicker rule (see `settleSpyRspVerdict`): it only moves off the last
   * shown verdict once a new one has held for two refreshes in a row.
   */
  verdict: SpyRspVerdict;
  /** The plain-English line for `verdict`. */
  line: string;
  /**
   * The verdict the two changes imply *this* refresh, before the anti-flicker
   * rule. Equal to `verdict` on a settled reading; differs for the one refresh
   * a change is still being confirmed. Kept for the health view and the tests.
   */
  rawVerdict: SpyRspVerdict;
  /**
   * A new verdict seen once and waiting for a second refresh to confirm, or
   * null when the shown verdict is steady. Carries the anti-flicker state
   * across refreshes.
   */
  pendingVerdict: SpyRspVerdict | null;
  /** When this reading was taken, ISO-8601 UTC — the real data time. */
  at: string;
}

/**
 * The verdict from the day's two changes. Pure, so every case is testable.
 *
 * The order is the priority the wording commits to:
 *
 *   1. A clear gap (> ±0.3pp) between the two is the strongest thing to say —
 *      the index and the average stock are genuinely parting ways, so that is
 *      the verdict whatever the absolute sizes.
 *   2. Otherwise, if both legs sit inside ±0.3%, nothing happened: "quiet".
 *   3. Otherwise, if both legs are clearly beyond ±0.5% the same way, the whole
 *      tape moved together: "broad".
 *   4. Everything in between — one leg out past the quiet band, no clear gap,
 *      not a wide move — is honestly just a "mixed" day.
 */
export function spyRspVerdict(spyPct: number, rspPct: number): SpyRspVerdict {
  const gap = rspPct - spyPct;

  // 1. A clear gap: the index and the average stock are parting ways.
  if (gap > GAP_BAND_PCT) {
    // Average stock ahead of the index. With the index itself red that is the
    // giants lagging while the rest hold up; otherwise the average is leading.
    return spyPct < 0 ? 'big-lagging' : 'avg-leading';
  }
  if (gap < -GAP_BAND_PCT) {
    // Average stock behind the index — the giants are doing the work. On an up
    // tape that is them carrying it; on a down tape, holding the line.
    return spyPct > 0 ? 'narrow' : 'narrow-down';
  }

  // 2. No gap worth noting, and both legs barely off zero: a quiet day.
  if (Math.abs(spyPct) <= QUIET_BAND_PCT && Math.abs(rspPct) <= QUIET_BAND_PCT) {
    return 'quiet';
  }

  // 3. Both legs clearly out, the same way: a broad move.
  if (spyPct > BROAD_BAND_PCT && rspPct > BROAD_BAND_PCT) return 'broad-up';
  if (spyPct < -BROAD_BAND_PCT && rspPct < -BROAD_BAND_PCT) return 'broad-down';

  // 4. Neither quiet nor broad nor clearly split.
  return 'mixed';
}

/**
 * The anti-flicker rule. Pure.
 *
 * The raw verdict can jitter between two readings when the gap or a leg is
 * sitting right on a band edge, and a card whose headline flips every refresh
 * reads as noise. So a *change* only takes effect once the new verdict has held
 * for two refreshes in a row: the first refresh records it as pending and keeps
 * showing the old one, the second confirms it.
 *
 * `prev` is the last shown reading (with its `verdict` and `pendingVerdict`);
 * pass null on the first reading of a session, which adopts the raw verdict at
 * once — there is nothing to flicker against yet.
 */
export function settleSpyRspVerdict(
  prev: Pick<SpyRspReading, 'verdict' | 'pendingVerdict'> | null,
  raw: SpyRspVerdict,
): { verdict: SpyRspVerdict; pendingVerdict: SpyRspVerdict | null } {
  // Nothing shown yet, or the raw verdict already matches what is shown: steady.
  if (!prev || raw === prev.verdict) {
    return { verdict: raw, pendingVerdict: null };
  }
  // The raw verdict differs from what is shown. If it is the same candidate we
  // saw last refresh, it has now held twice — switch. Otherwise hold the shown
  // verdict and remember this one as the new candidate.
  if (prev.pendingVerdict === raw) {
    return { verdict: raw, pendingVerdict: null };
  }
  return { verdict: prev.verdict, pendingVerdict: raw };
}

/**
 * Apply the anti-flicker rule to a freshly built reading, given the last shown
 * one. Returns the reading to store and render: same numbers and `rawVerdict`,
 * but `verdict`/`line`/`pendingVerdict` settled against `prev`.
 */
export function applySpyRspHysteresis(
  prev: SpyRspReading | null,
  next: SpyRspReading,
): SpyRspReading {
  const settled = settleSpyRspVerdict(prev, next.rawVerdict);
  return {
    ...next,
    verdict: settled.verdict,
    line: SPY_RSP_VERDICT_LINE[settled.verdict],
    pendingVerdict: settled.pendingVerdict,
  };
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
    // A freshly built reading is its own raw verdict; the anti-flicker rule
    // (see `applySpyRspHysteresis`) settles it against the last shown reading
    // at store time, and a store with no prior reading adopts it as-is.
    verdict,
    line: SPY_RSP_VERDICT_LINE[verdict],
    rawVerdict: verdict,
    pendingVerdict: null,
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
  // `+ 0` collapses a negative zero so a -0.04% reading never prints "-0.0%".
  return `${(Math.abs(pct) + 0).toFixed(1)}%`;
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
