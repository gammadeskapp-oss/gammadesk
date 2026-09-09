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
  EPISODIC_DEFAULTS,
  GAP_CLOSE_TOP_FRACTION,
  GAP_LOOKBACK,
  GRID_GAP_PCTS,
  GRID_VOLUME_MULTS,
  MIN_BARS,
  PAUSE_TIGHT_WINDOW,
  PAUSE_VOLUME_WINDOW,
  POST_GAP_MAX_SESSIONS,
  UNIVERSE_MIN_AVG_VOLUME,
  UNIVERSE_MIN_PRICE,
  type EpisodicBar,
  type EpisodicFinding,
  type EpisodicPause,
  type EpisodicParams,
  type EpisodicYearFunnel,
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
 * Every rule's verdict for one candidate gap day at index `i`, computed in one
 * place so the live scan and the historical backfill apply *identical* rules —
 * the whole point of the backfill is to calibrate the real scanner, not a copy.
 *
 * Gap-day criteria (gap %, top-half close, volume, dollar) are evaluated first;
 * the base checks (freshness, range, trend, volume-rise) are only computed when
 * the day is actually a gap day, since on a year of history the overwhelming
 * majority of days are not and the base maths would be wasted. `i` must be at
 * least `BASE_LOOKBACK` with `i-1 >= 0`.
 */
export interface GapEval {
  isGapDay: boolean;
  gapPct: number;
  volumeRatio: number;
  dollarVolume: number;
  avg50Volume: number;
  fresh: boolean;
  baseRangePct: number;
  baseWideOk: boolean;
  trendOk: boolean;
  volRiseOk: boolean;
}

function evalGapAt(
  bars: EpisodicBar[],
  i: number,
  params: EpisodicParams,
  volumes: number[],
): GapEval {
  const empty: GapEval = {
    isGapDay: false,
    gapPct: 0,
    volumeRatio: 0,
    dollarVolume: 0,
    avg50Volume: 0,
    fresh: false,
    baseRangePct: 0,
    baseWideOk: false,
    trendOk: false,
    volRiseOk: false,
  };

  const bar = bars[i];
  const prevClose = bars[i - 1].close;

  // --- gap-day criteria ---
  if (!gapsUp(bar.open, prevClose, params.gapMinPct)) return empty;
  const span = bar.high - bar.low;
  if (span <= 0) return empty;
  if ((bar.close - bar.low) / span < GAP_CLOSE_TOP_FRACTION) return empty;
  const avg50 = mean(volumes, i - ADV_WINDOW, i);
  if (avg50 === null || avg50 <= 0) return empty;
  const volumeRatio = bar.volume / avg50;
  if (volumeRatio < params.volumeMult) return empty;
  const dollarVolume = bar.close * bar.volume;
  if (dollarVolume < params.dollarMin) return empty;

  const gapPct = (bar.open - prevClose) / prevClose;

  // --- base checks (only now that it is a gap day) ---
  const baseFrom = i - BASE_LOOKBACK;

  let fresh = true;
  for (let j = baseFrom; j < i; j += 1) {
    if (j - 1 < 0) continue;
    if (gapsUp(bars[j].open, bars[j - 1].close, params.gapMinPct)) {
      fresh = false;
      break;
    }
  }

  const { high: baseHigh, low: baseLow } = extent(bars, baseFrom, i);
  const baseRangePct = baseLow > 0 ? (baseHigh - baseLow) / baseLow : Infinity;
  const baseWideOk = baseLow > 0 && baseRangePct <= params.baseRangeMax;

  const baseCloses: number[] = [];
  for (let k = baseFrom; k < i; k += 1) baseCloses.push(bars[k].close);
  const { r2, rise } = trendFit(baseCloses);
  const trendOk = !(r2 >= BASE_MAX_TREND_R2 && rise >= BASE_MIN_TREND_RISE);

  const half = Math.floor(BASE_LOOKBACK / 2);
  const earlyVol = mean(volumes, baseFrom, baseFrom + half);
  const lateVol = mean(volumes, i - half, i);
  const volRiseOk = !(
    earlyVol !== null &&
    lateVol !== null &&
    earlyVol > 0 &&
    lateVol / earlyVol > BASE_VOLUME_RISE_MAX
  );

  return {
    isGapDay: true,
    gapPct,
    volumeRatio,
    dollarVolume,
    avg50Volume: avg50,
    fresh,
    baseRangePct,
    baseWideOk,
    trendOk,
    volRiseOk,
  };
}

/** The ordered drop reason for a gap day, or null when it passes everything. */
function orderedDrop(e: GapEval): ScanDrop | null {
  if (!e.fresh) return 'not-fresh';
  if (!e.baseWideOk) return 'base-too-wide';
  if (!e.trendOk) return 'base-trending';
  if (!e.volRiseOk) return 'base-vol-rising';
  return null;
}

/** Whether a gap-day evaluation clears the shipped capture thresholds. */
function atCapture(e: GapEval, capture: EpisodicParams): boolean {
  return (
    e.gapPct >= capture.gapMinPct &&
    e.volumeRatio >= capture.volumeMult &&
    e.dollarVolume >= capture.dollarMin &&
    e.baseRangePct <= capture.baseRangeMax
  );
}

/**
 * Assemble a finding for the gap at index `i`. `end` bounds the window used for
 * the pause and the chart: the live scan passes the series length (measure
 * through today), the backfill passes a few weeks after the gap so a months-old
 * episode's pause reads off its pause, not half a year of later drift.
 */
function buildFinding(
  symbol: string,
  name: string | null,
  bars: EpisodicBar[],
  i: number,
  e: GapEval,
  end: number,
): EpisodicFinding {
  const view = end >= bars.length ? bars : bars.slice(0, end);
  const currentPrice = view[view.length - 1].close;
  const gap = bars[i];
  const pctFromGapClose = gap.close > 0 ? (currentPrice - gap.close) / gap.close : 0;
  const chartBars = view.slice(Math.max(0, i - BASE_LOOKBACK));

  return {
    symbol,
    name,
    gapDate: gap.date,
    gapPct: e.gapPct,
    volumeRatio: e.volumeRatio,
    dollarVolume: e.dollarVolume,
    baseRangePct: e.baseRangePct,
    gapOpen: gap.open,
    gapHigh: gap.high,
    gapLow: gap.low,
    gapClose: gap.close,
    gapVolume: gap.volume,
    avg50Volume: e.avg50Volume,
    currentPrice,
    pctFromGapClose,
    pause: buildPause(view, i),
    bars: chartBars,
  };
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
  // it, so the earliest index it can occupy is `BASE_LOOKBACK`. The first gap
  // day that clears the gap-day criteria is *the* episode; a later one carries
  // it in its own base and would fail freshness anyway.
  const firstCandidate = Math.max(BASE_LOOKBACK, n - GAP_LOOKBACK);

  let gapIndex = -1;
  let ev: GapEval | null = null;
  for (let i = firstCandidate; i < n; i += 1) {
    const e = evalGapAt(bars, i, params, volumes);
    if (!e.isGapDay) continue;
    gapIndex = i;
    ev = e;
    break;
  }

  if (gapIndex < 0 || !ev) return { kind: 'drop', reason: 'no-gap' };

  const drop = orderedDrop(ev);
  if (drop) return { kind: 'drop', reason: drop };

  // Measured through the latest session — the live scan's "since the gap".
  return { kind: 'finding', finding: buildFinding(symbol, name, bars, gapIndex, ev, n) };
}

/**
 * Run the scan across a window of history, returning every qualifying gap.
 *
 * The live `scanSeries` only ever looks at the last 20 sessions; this slides
 * the identical rules (via the shared `evalGapAt`) across a whole `fromDate`→end
 * window so the rules can be read over time rather than on one day. Candidates
 * are detected at the loosest grid thresholds so the sensitivity grid can be
 * filled from a single pass, and each qualifying gap becomes a finding bounded
 * to the weeks after it. Per-symbol tallies here are summed across the universe
 * in `refresh.ts`.
 */
export interface HistoryScan {
  /** Findings at the shipped capture thresholds, bounded post-gap. */
  findings: EpisodicFinding[];
  /** Would-be findings the base-trend filter removed (for step-3 eyeballing). */
  trendRemoved: EpisodicFinding[];
  funnel: EpisodicYearFunnel;
  /** grid[gapIndex][volIndex] over GRID_GAP_PCTS × GRID_VOLUME_MULTS. */
  grid: number[][];
}

export function scanHistory(
  symbol: string,
  name: string | null,
  bars: EpisodicBar[],
  fromDate: string,
  detect: EpisodicParams,
  capture: EpisodicParams,
): HistoryScan {
  const funnel: EpisodicYearFunnel = {
    candidateGapDays: 0,
    droppedLiquidity: 0,
    droppedNotFresh: 0,
    droppedBaseTooWide: 0,
    droppedBaseTrending: 0,
    droppedBaseVolRising: 0,
    findings: 0,
  };
  const grid = GRID_GAP_PCTS.map(() => GRID_VOLUME_MULTS.map(() => 0));
  const findings: EpisodicFinding[] = [];
  const trendRemoved: EpisodicFinding[] = [];

  const n = bars.length;
  if (n < MIN_BARS) return { findings, trendRemoved, funnel, grid };

  const volumes = bars.map((b) => b.volume);

  for (let i = BASE_LOOKBACK; i < n; i += 1) {
    if (bars[i].date < fromDate) continue;

    const e = evalGapAt(bars, i, detect, volumes);
    if (!e.isGapDay) continue;
    funnel.candidateGapDays += 1;

    // Liquidity as of the gap, not as of today: was this a $5+, 500k-share name
    // during its base? (The live scan uses today's price/volume; a backfill has
    // to judge each episode at its own time.)
    const price = bars[i - 1].close;
    const adv = mean(volumes, i - ADV_WINDOW, i);
    if (price < UNIVERSE_MIN_PRICE || adv === null || adv < UNIVERSE_MIN_AVG_VOLUME) {
      funnel.droppedLiquidity += 1;
      continue;
    }

    const end = Math.min(n, i + POST_GAP_MAX_SESSIONS + 1);

    if (!e.fresh) {
      funnel.droppedNotFresh += 1;
      continue;
    }
    if (!e.baseWideOk) {
      funnel.droppedBaseTooWide += 1;
      continue;
    }
    if (!e.trendOk) {
      funnel.droppedBaseTrending += 1;
      // A would-be finding the trend filter alone removed — kept for step 3.
      if (e.volRiseOk && atCapture(e, capture)) {
        trendRemoved.push(buildFinding(symbol, name, bars, i, e, end));
      }
      continue;
    }
    if (!e.volRiseOk) {
      funnel.droppedBaseVolRising += 1;
      continue;
    }

    // Passed every rule. Fill the sensitivity grid, varying only gap and volume
    // with the dollar and base-range rules held at their shipped defaults — so a
    // grid cell reads as the finding count you would actually get at that gap ×
    // volume pair, and the 5%/5× cell equals the board's default count.
    const gridEligible =
      e.dollarVolume >= EPISODIC_DEFAULTS.dollarMin &&
      e.baseRangePct <= EPISODIC_DEFAULTS.baseRangeMax;
    if (gridEligible) {
      for (let g = 0; g < GRID_GAP_PCTS.length; g += 1) {
        for (let v = 0; v < GRID_VOLUME_MULTS.length; v += 1) {
          if (e.gapPct >= GRID_GAP_PCTS[g] && e.volumeRatio >= GRID_VOLUME_MULTS[v]) {
            grid[g][v] += 1;
          }
        }
      }
    }

    if (atCapture(e, capture)) {
      funnel.findings += 1;
      findings.push(buildFinding(symbol, name, bars, i, e, end));
    }
  }

  return { findings, trendRemoved, funnel, grid };
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
