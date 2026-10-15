/**
 * Quality gates for the Daily 20 — the minimum standard a name must clear to be
 * eligible, applied BEFORE ranking so a high score can never drag an
 * unqualified name onto the list.
 *
 * ## Gate vs flag vs score
 *
 * A **gate** is pass/fail eligibility: fail one and the name cannot enter the
 * Daily 20 at any score. A **flag** is a caution that rides along with a name
 * that did pass — "extended", "fresh breakdown", "earnings soon" — and never
 * removes it. The **score** (see `directionScore.ts`) then orders the names that
 * passed the gate. Keeping the three apart is what lets the page rank without
 * recommending: the gate decides who is eligible, the flag says what to watch,
 * the score says how strong.
 *
 * ## "Unknown" is not "fail", except for the structural leader test
 *
 * The codebase rule is that an unmeasured reading does not count against a name
 * (a chain nobody pulled has not scored badly). That holds here for options:
 * most names have no chain, so the options gate only bites when a chain exists.
 * It does NOT hold for the core structural tests — above/below the 50-day MA,
 * the moving-average order, relative-strength posture — because those ARE the
 * definition of a leader or a laggard. A name whose 50-day MA could not be
 * computed has not been shown to be a leader, and the Daily 20 is a curated ten,
 * not a best-effort one, so it is held out with its reason stated.
 *
 * ## "RS vs SPY" is read as index-relative percentile
 *
 * The spec asks for RS vs SPY positive on ≥2 of 3 lookbacks (20/60/120 sessions).
 * SPY is an ETF and is not in the S&P-constituent universe the RS engine ranks,
 * so there is no SPY return in the digest to subtract. Instead we use the
 * engine's own per-window percentiles (m1≈20, m3≈60, m6≈120 sessions): a
 * percentile at or above 50 means the name outperformed most of the index over
 * that window, which is what "relative strength is positive" is actually asking.
 * The percentiles are supplied by the caller from the RS result.
 *
 * Nothing here is phrased as a recommendation. A name that clears the bullish
 * gate is eligible to be *ranked as a leader*; it is never "a buy".
 */

import { excludedForEarnings } from './earningsRules';
import type { Direction } from './directionScore';
import type { ScanRow } from './types';

// --- tunable thresholds ------------------------------------------------------

export interface GateSettings {
  /** Average daily dollar turnover floor. Spec default $20M. */
  minDollarVolume: number;
  /** Whole-chain open interest floor — only applied when a chain exists. */
  minOptionsOpenInterest: number;
  /** Max best-contract spread as a % of mid — only applied when graded. */
  maxSpreadPctOfMid: number;
  /** How many of the three RS windows must be positive (percentile ≥ floor). */
  rsWindowsRequired: number;
  /** The per-window percentile that counts as "RS positive" for that window. */
  rsPercentileFloor: number;
  /** Distance from the 20-day MA past which a name is flagged extended/stretched. */
  extendedPct: number;
  /** Calendar days inside which an upcoming report gates a name out. */
  earningsWindowDays: number;
}

/** Shipped Daily 20 gate defaults. Tune here. */
export const DAILY20_GATES: GateSettings = {
  minDollarVolume: 20_000_000,
  minOptionsOpenInterest: 1_000,
  maxSpreadPctOfMid: 15,
  rsWindowsRequired: 2,
  rsPercentileFloor: 50,
  extendedPct: 8,
  earningsWindowDays: 7,
};

/** Per-run switches a reader can set; both off by default. */
export interface GateFlags {
  /** Let a name with earnings inside the window through (an "earnings play"). */
  earningsPlay: boolean;
  /**
   * Bullish only: allow a name whose 50-day is still below its 200-day in when
   * the shorter trend is clearly improving (20-day back above the 50-day).
   */
  allowImprovingTrend: boolean;
}

export const DEFAULT_GATE_FLAGS: GateFlags = {
  earningsPlay: false,
  allowImprovingTrend: false,
};

/** Per-window RS percentiles (0-100), straight off the RS engine's `RsRow`. */
export interface RsWindows {
  m1: number | null;
  m3: number | null;
  m6: number | null;
}

export interface GateInput {
  settings?: GateSettings;
  flags?: GateFlags;
  /** Per-window RS percentiles; when absent the RS window test is unmeasured. */
  rsPercentiles?: RsWindows | null;
}

// --- the result --------------------------------------------------------------

/** Non-blocking cautions attached to a name that passed the gate. */
export interface GateObservations {
  /** Bullish: >extendedPct above the 20-day MA. Bearish: >extendedPct below it (stretched). */
  extended: boolean;
  /** Bullish only: entered via the improving-trend allowance rather than 50>200. */
  usedImprovingTrend: boolean;
  /** An upcoming report sits inside the window (let through by the earnings-play flag). */
  earningsSoon: boolean;
  /** No chain was pulled, so the options gate could not be applied. */
  optionsUnchecked: boolean;
  /** Bearish: fresh (just lost the 50-day) vs stretched (far below it). Null for bullish. */
  breakdownPhase: 'fresh' | 'stretched' | null;
}

export interface GateResult {
  direction: Direction;
  /** True when every applicable gate passed. */
  passes: boolean;
  /** Why it was gated out, worst first. Empty when it passed. */
  reasons: string[];
  observations: GateObservations;
}

// --- helpers -----------------------------------------------------------------

/** Count of windows at or above the floor, and how many had a reading. */
function countRsWindows(p: RsWindows | null | undefined, floor: number, positive: boolean) {
  if (!p) return { count: 0, measured: 0 };
  let count = 0;
  let measured = 0;
  for (const w of [p.m1, p.m3, p.m6]) {
    if (w === null || !Number.isFinite(w)) continue;
    measured += 1;
    if (positive ? w >= floor : w < floor) count += 1;
  }
  return { count, measured };
}

// --- the gate ----------------------------------------------------------------

export function gateRow(row: ScanRow, direction: Direction, input: GateInput = {}): GateResult {
  const s = input.settings ?? DAILY20_GATES;
  const flags = input.flags ?? DEFAULT_GATE_FLAGS;
  const m = row.metrics;
  const reasons: string[] = [];

  const obs: GateObservations = {
    extended: false,
    usedImprovingTrend: false,
    earningsSoon: false,
    optionsUnchecked: row.optionQuality === null || row.optionQuality?.contract == null,
    breakdownPhase: null,
  };

  // --- liquidity (shared) ----------------------------------------------------
  if (!(m.avgDollarVolume > 0)) {
    reasons.push('no turnover reading');
  } else if (m.avgDollarVolume < s.minDollarVolume) {
    reasons.push(
      `turnover ${fmtDollars(m.avgDollarVolume)}/day, under the ${fmtDollars(s.minDollarVolume)} floor`,
    );
  }

  // --- options (shared, soft) ------------------------------------------------
  // Only bites when a chain exists — most names have none, and an unpulled chain
  // is not evidence of an untradable one.
  const contract = row.optionQuality?.contract ?? null;
  if (contract) {
    if (row.optionsOpenInterest !== null && row.optionsOpenInterest < s.minOptionsOpenInterest) {
      reasons.push(
        `chain open interest ${Math.round(row.optionsOpenInterest)}, under ${s.minOptionsOpenInterest}`,
      );
    }
    if (contract.spreadPctOfMid !== null && contract.spreadPctOfMid > s.maxSpreadPctOfMid) {
      reasons.push(
        `best-contract spread ${contract.spreadPctOfMid.toFixed(0)}%, over the ${s.maxSpreadPctOfMid}% cap`,
      );
    }
  }

  // --- earnings (shared) -----------------------------------------------------
  const earningsExcluded = excludedForEarnings(row.earnings, s.earningsWindowDays);
  if (earningsExcluded) {
    obs.earningsSoon = true;
    if (!flags.earningsPlay) {
      reasons.push(
        `reports within ${s.earningsWindowDays}d${
          row.earnings.daysAway !== null ? ` (${row.earnings.daysAway}d)` : ''
        } — turn on "earnings play" to include`,
      );
    }
  }

  // --- RS window posture (shared, direction-specific) ------------------------
  const positive = direction === 'bullish';
  const rs = countRsWindows(input.rsPercentiles, s.rsPercentileFloor, positive);
  if (rs.measured === 0) {
    reasons.push('no relative-strength windows could be read');
  } else if (rs.count < s.rsWindowsRequired) {
    reasons.push(
      `relative strength ${positive ? 'positive' : 'negative'} on only ${rs.count} of ${rs.measured} lookbacks (needs ${s.rsWindowsRequired})`,
    );
  }

  // --- direction-specific structure -----------------------------------------
  if (direction === 'bullish') {
    if (m.pctAbove50 === null) reasons.push('50-day average could not be computed');
    else if (m.pctAbove50 < 0) reasons.push('below its 50-day average');

    // 50 above 200, or the improving-trend allowance behind its flag.
    if (m.ema50 === null || m.ema200 === null) {
      reasons.push('moving-average order could not be computed');
    } else if (m.ema50 < m.ema200) {
      const improving = flags.allowImprovingTrend && m.ema20 !== null && m.ema20 >= m.ema50;
      if (improving) obs.usedImprovingTrend = true;
      else reasons.push('50-day below its 200-day (turn on "improving trend" to include)');
    }

    obs.extended = m.pctAbove20 !== null && m.pctAbove20 > s.extendedPct;
  } else {
    if (m.pctAbove50 === null) reasons.push('50-day average could not be computed');
    else if (m.pctAbove50 >= 0) reasons.push('above its 50-day average');

    // A confirmed downtrend: death order or already below the 200-day.
    const deathOrder = m.ema50 !== null && m.ema200 !== null && m.ema50 < m.ema200;
    const below200 = m.pctAbove200 !== null && m.pctAbove200 < 0;
    if (m.ema50 === null && m.ema200 === null && m.pctAbove200 === null) {
      reasons.push('trend structure could not be computed');
    } else if (!deathOrder && !below200) {
      reasons.push('no breakdown structure yet (50 still above 200 and above the 200-day)');
    }

    // Fresh breakdown vs stretched, from distance below the 20-day MA.
    if (m.pctAbove20 !== null) {
      obs.extended = m.pctAbove20 < -s.extendedPct;
      obs.breakdownPhase = m.pctAbove20 < -s.extendedPct ? 'stretched' : 'fresh';
    }
  }

  return { direction, passes: reasons.length === 0, reasons, observations: obs };
}

function fmtDollars(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}bn`;
  return `$${Math.round(v / 1e6)}M`;
}
