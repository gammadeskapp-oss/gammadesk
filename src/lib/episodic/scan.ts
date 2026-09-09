/**
 * The episodic-pivot scan, as a pure function.
 *
 * Client-safe and dependency-free of anything that reaches the network: it
 * takes one symbol's daily bars and the capture thresholds and returns either a
 * finding or the one reason the name dropped out. Keeping it pure is what lets
 * `verify:episodic` walk the whole rule set on synthetic bars without a fetch,
 * and it is why `./refresh.ts` does all the fetching and none of the deciding.
 *
 * ## The shape it is looking for
 *
 * A stock that was flat and ignored, then gapped up hard on heavy volume:
 *
 *  - a **gap** of at least `gapMinPct`, open against the prior close, landing
 *    within the last `GAP_LOOKBACK` sessions;
 *  - the gap day **closing in the top half** of its own range;
 *  - gap-day **volume** at least `volumeMult` times the 50-day average;
 *  - gap-day **dollar volume** at least `dollarMin`;
 *  - a **quiet base** before it: a `BASE_LOOKBACK`-session range no wider than
 *    `baseRangeMax`, whose 50-day average volume was not already climbing
 *    sharply into the gap;
 *  - and **freshness**: no earlier gap of the same size sitting inside that
 *    base, so this is a first move rather than the second leg of one.
 *
 * The earliest qualifying gap in the window is the episode: a later one would
 * carry the earlier gap in its own base and fail the freshness test, so there
 * is only ever one viable episode per name.
 *
 * ## And the pause tracker
 *
 * For a name that qualifies, the same bars measure what it has done since:
 * whether it has held the midpoint of the gap day (a break flags it dead), how
 * tight the last five sessions are (tightening is constructive), whether volume
 * is drying up, and the high of the current tight range as a reference level.
 * This is the important half, and it costs nothing extra — the bars are already
 * in hand.
 */

import {
  ADV_WINDOW,
  BASE_LOOKBACK,
  BASE_MAX_TREND_R2,
  BASE_MIN_TREND_RISE,
  BASE_VOLUME_RISE_MAX,
  GAP_CLOSE_TOP_FRACTION,
  GAP_LOOKBACK,
  MIN_BARS,
  PAUSE_TIGHT_WINDOW,
  PAUSE_VOLUME_WINDOW,
  UNIVERSE_MIN_AVG_VOLUME,
  UNIVERSE_MIN_PRICE,
  type EpisodicBar,
  type EpisodicFinding,
  type EpisodicPause,
  type EpisodicParams,
} from './types';

/**
 * Why a name left the scan, in the order the funnel applies the stages.
 *
 * The quiet-base test has two distinct failure modes kept apart on purpose:
 * `base-too-wide` (the price range over the base blew past the limit) and
 * `base-vol-rising` (volume was already climbing sharply into the gap). They
 * are different stories, and separating them is what lets the page — and a
 * skeptical operator — see exactly how many names the volume-rise rule removed,
 * which was a judgment call worth being able to audit.
 */
export type ScanDrop =
  | 'short-history'
  | 'liquidity'
  | 'no-gap'
  | 'not-fresh'
  | 'base-too-wide'
  | 'base-trending'
  | 'base-vol-rising';

export type ScanResult =
  | { kind: 'finding'; finding: EpisodicFinding }
  | { kind: 'drop'; reason: ScanDrop };

/** Mean over `[from, to)`, or null when the slice is empty or out of range. */
function mean(values: number[], from: number, to: number): number | null {
  if (from < 0 || to > values.length || to <= from) return null;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += values[i];
  return sum / (to - from);
}

/** Highest high and lowest low over `[from, to)`. Assumes a valid range. */
function extent(bars: EpisodicBar[], from: number, to: number): { high: number; low: number } {
  let high = -Infinity;
  let low = Infinity;
  for (let i = from; i < to; i += 1) {
    if (bars[i].high > high) high = bars[i].high;
    if (bars[i].low < low) low = bars[i].low;
  }
  return { high, low };
}

/** True when `open` gaps up from `prevClose` by at least `pct` (a fraction). */
function gapsUp(open: number, prevClose: number, pct: number): boolean {
  return prevClose > 0 && (open - prevClose) / prevClose >= pct;
}

/**
 * Fit the values to a line and report how clean the trend is (R², 0..1) and the
 * net rise the fit implies across the window, as a fraction of the first fitted
 * value. Used to separate a flat, ignored base from a base that was already
 * climbing in a clean channel.
 */
function trendFit(values: number[]): { r2: number; rise: number } {
  const n = values.length;
  if (n < 2) return { r2: 0, rise: 0 };
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (i - mx) * (values[i] - my);
    sxx += (i - mx) ** 2;
    syy += (values[i] - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return { r2: 0, rise: 0 };
  const slope = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  // Rise implied by the fitted line from the first to the last point, relative
  // to the fitted start — steadier than raw first/last endpoints.
  const fittedStart = my - slope * mx;
  const rise = fittedStart > 0 ? (slope * (n - 1)) / fittedStart : 0;
  return { r2, rise };
}

/**
 * The pause tracker for a qualifying name, measured from the gap day forward.
 *
 * Both "last 5 sessions" readings are withheld until there are five sessions
 * *since* the gap: a range or a relative-volume figure whose last-five window
 * still contained the gap day would read off the gap itself, not the pause
 * after it. The 20-day volume baseline the last five are compared against is a
 * trailing average and may legitimately include the base and the gap — that is
 * the window volume dried up *from* — so it is not gated the same way. Note
 * that a qualifying gap is always within `GAP_LOOKBACK` sessions, so
 * `sessionsSinceGap` never reaches 20; gating the volume ratio on 20 post-gap
 * sessions instead of five would mean it never appeared at all.
 */
function buildPause(bars: EpisodicBar[], gapIndex: number): EpisodicPause {
  const n = bars.length;
  const gap = bars[gapIndex];
  const midpoint = (gap.high + gap.low) / 2;
  const sessionsSinceGap = n - 1 - gapIndex;

  // The lowest close from the gap day onward. The gap day itself closed in the
  // top half by construction, so it never sets this below the midpoint.
  let lowestCloseSinceGap = gap.close;
  for (let i = gapIndex; i < n; i += 1) {
    if (bars[i].close < lowestCloseSinceGap) lowestCloseSinceGap = bars[i].close;
  }
  const heldAboveMid = lowestCloseSinceGap >= midpoint;

  let last5RangePct: number | null = null;
  let tightRangeHigh: number | null = null;
  if (sessionsSinceGap >= PAUSE_TIGHT_WINDOW) {
    const { high, low } = extent(bars, n - PAUSE_TIGHT_WINDOW, n);
    if (low > 0) {
      last5RangePct = (high - low) / low;
      tightRangeHigh = high;
    }
  }

  let vol5vs20: number | null = null;
  if (sessionsSinceGap >= PAUSE_TIGHT_WINDOW && n >= PAUSE_VOLUME_WINDOW) {
    const volumes = bars.map((b) => b.volume);
    const recent = mean(volumes, n - PAUSE_TIGHT_WINDOW, n);
    const trailing = mean(volumes, n - PAUSE_VOLUME_WINDOW, n);
    if (recent !== null && trailing !== null && trailing > 0) {
      vol5vs20 = recent / trailing;
    }
  }

  return {
    sessionsSinceGap,
    heldAboveMid,
    midpoint,
    lowestCloseSinceGap,
    last5RangePct,
    vol5vs20,
    tightRangeHigh,
  };
}

/**
 * Run the scan over one symbol's bars.
 *
 * `bars` must be oldest-first daily OHLCV. `params` is the capture envelope —
 * the scan always runs at its widest and the UI tightens later, so a caller
 * passing the shipped defaults here would quietly stop the sliders from ever
 * loosening.
 */
export function scanSeries(
  symbol: string,
  name: string | null,
  bars: EpisodicBar[],
  params: EpisodicParams,
): ScanResult {
  const n = bars.length;
  if (n < MIN_BARS) return { kind: 'drop', reason: 'short-history' };

  // --- liquidity floor -------------------------------------------------------
  const volumes = bars.map((b) => b.volume);
  const currentPrice = bars[n - 1].close;
  const advRecent = mean(volumes, n - ADV_WINDOW, n);
  if (
    currentPrice < UNIVERSE_MIN_PRICE ||
    advRecent === null ||
    advRecent < UNIVERSE_MIN_AVG_VOLUME
  ) {
    return { kind: 'drop', reason: 'liquidity' };
  }

  // --- find the earliest qualifying gap in the lookback window ---------------
  // A gap day needs a full base and a 50-session volume average sitting before
  // it, so the earliest index it can occupy is `BASE_LOOKBACK`.
  const firstCandidate = Math.max(BASE_LOOKBACK, n - GAP_LOOKBACK);

  let gapIndex = -1;
  let gapPct = 0;
  let volumeRatio = 0;
  let dollarVolume = 0;
  let avg50Volume = 0;

  for (let i = firstCandidate; i < n; i += 1) {
    const bar = bars[i];
    const prevClose = bars[i - 1].close;

    if (!gapsUp(bar.open, prevClose, params.gapMinPct)) continue;

    // Close in the top half of the day's range.
    const span = bar.high - bar.low;
    if (span <= 0) continue;
    if ((bar.close - bar.low) / span < GAP_CLOSE_TOP_FRACTION) continue;

    // Volume against the 50-session average ending the day before the gap.
    const avg50 = mean(volumes, i - ADV_WINDOW, i);
    if (avg50 === null || avg50 <= 0) continue;
    const ratio = bar.volume / avg50;
    if (ratio < params.volumeMult) continue;

    // Dollar volume that day.
    const dollars = bar.close * bar.volume;
    if (dollars < params.dollarMin) continue;

    gapIndex = i;
    gapPct = (bar.open - prevClose) / prevClose;
    volumeRatio = ratio;
    dollarVolume = dollars;
    avg50Volume = avg50;
    break;
  }

  if (gapIndex < 0) return { kind: 'drop', reason: 'no-gap' };

  // --- freshness: no earlier gap of the same size inside the prior base ------
  const baseFrom = gapIndex - BASE_LOOKBACK;
  for (let j = baseFrom; j < gapIndex; j += 1) {
    if (j - 1 < 0) continue;
    if (gapsUp(bars[j].open, bars[j - 1].close, params.gapMinPct)) {
      return { kind: 'drop', reason: 'not-fresh' };
    }
  }

  // --- quiet base ------------------------------------------------------------
  const { high: baseHigh, low: baseLow } = extent(bars, baseFrom, gapIndex);
  if (baseLow <= 0) return { kind: 'drop', reason: 'base-too-wide' };
  const baseRangePct = (baseHigh - baseLow) / baseLow;
  if (baseRangePct > params.baseRangeMax) {
    return { kind: 'drop', reason: 'base-too-wide' };
  }

  // A base that fits a rising line cleanly was already trending, not flat and
  // ignored — the range test cannot see this, because a rising channel and a
  // sideways band of the same amplitude have the same high-minus-low. Only an
  // *upward* clean trend is rejected; a gap up out of a clean downtrend is a
  // reversal and kept.
  const baseCloses: number[] = [];
  for (let i = baseFrom; i < gapIndex; i += 1) baseCloses.push(bars[i].close);
  const { r2, rise } = trendFit(baseCloses);
  if (r2 >= BASE_MAX_TREND_R2 && rise >= BASE_MIN_TREND_RISE) {
    return { kind: 'drop', reason: 'base-trending' };
  }

  // The 50-day average volume must not already have been climbing sharply into
  // the gap: compare the recent half of the base against its earlier half.
  const half = Math.floor(BASE_LOOKBACK / 2);
  const earlyVol = mean(volumes, baseFrom, baseFrom + half);
  const lateVol = mean(volumes, gapIndex - half, gapIndex);
  if (earlyVol !== null && lateVol !== null && earlyVol > 0) {
    if (lateVol / earlyVol > BASE_VOLUME_RISE_MAX) {
      return { kind: 'drop', reason: 'base-vol-rising' };
    }
  }

  // --- a finding -------------------------------------------------------------
  const gap = bars[gapIndex];
  const pctFromGapClose = gap.close > 0 ? (currentPrice - gap.close) / gap.close : 0;

  // The chart window: the whole base through the latest session, so the flat
  // stretch, the jump and everything since are all visible with the gap marked.
  const chartFrom = Math.max(0, gapIndex - BASE_LOOKBACK);
  const chartBars = bars.slice(chartFrom);

  const finding: EpisodicFinding = {
    symbol,
    name,
    gapDate: gap.date,
    gapPct,
    volumeRatio,
    dollarVolume,
    baseRangePct,
    gapOpen: gap.open,
    gapHigh: gap.high,
    gapLow: gap.low,
    gapClose: gap.close,
    gapVolume: gap.volume,
    avg50Volume,
    currentPrice,
    pctFromGapClose,
    pause: buildPause(bars, gapIndex),
    bars: chartBars,
  };

  return { kind: 'finding', finding };
}

/**
 * Apply the display thresholds to a stored finding, entirely client-safe.
 *
 * The scan kept every survivor of the capture envelope; this is the tightening
 * the UI does on top, and the board and the funnel both call it so they cannot
 * disagree about which names a given setting keeps.
 */
export function passesDisplay(finding: EpisodicFinding, params: EpisodicParams): boolean {
  return (
    finding.gapPct >= params.gapMinPct &&
    finding.volumeRatio >= params.volumeMult &&
    finding.dollarVolume >= params.dollarMin &&
    finding.baseRangePct <= params.baseRangeMax
  );
}
