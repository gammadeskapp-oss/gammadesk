import {
  OPTION_WINDOW,
  type OptionContract,
  type OptionQuality,
  type OptionQualityBadge,
  type OptionQualitySource,
} from './types';

/**
 * The contract check: is there actually a call worth trading on this name?
 *
 * ## Why this gate exists
 *
 * Everything upstream measures the *stock*. A name can clear all five gates —
 * strong, trending, confirmed, liquid in shares, in a calm market — and still
 * have an options chain nobody should touch: a 12% bid/ask spread on 40 open
 * interest hands the whole edge to the market maker before the trade has done
 * anything. The reader cannot see that from the stock, which is exactly why
 * the page has to.
 *
 * ## Grading, and why `unknown` is not `caution`
 *
 * A missing spread or a missing open interest is not a bad contract, it is an
 * ungraded one. `caution` says "we looked and it is marginal"; `unknown` says
 * "we could not look". Merging them would let the page imply a measurement it
 * never made — and, worse, the reverse merge would put a green badge over
 * incomplete data, which is the one outcome this file is written to prevent.
 *
 * Pure and input-only, so `verify:scanner` can walk the grading table without
 * a network. The fetching lives in `optionChainQuality.ts`.
 */

/**
 * Thresholds, worst-first in each band.
 *
 * Chosen against liquid single-name calls in the 30-60 DTE window, where a
 * genuinely tight chain quotes inside 2% of mid on four figures of open
 * interest, and anything past 10% is a spread the position starts behind by.
 */
export const QUALITY_THRESHOLDS = {
  excellent: { maxSpreadPct: 2, minOi: 1000, minVolume: 0 },
  tradable: { maxSpreadPct: 5, minOi: 250, minVolume: 0 },
  caution: { maxSpreadPct: 10, minOi: 50, minVolume: 0 },
  /** Past `caution` on either axis is `avoid`. */
  avoidBelowOi: 50,
  avoidAboveSpreadPct: 10,
  /** Implied vol above this is called out, though it never alone makes `avoid`. */
  elevatedIvPct: 80,
} as const;

export interface GradeInput {
  contract: OptionContract | null;
  /** Days to the next earnings report, or null when the date is unknown. */
  earningsDaysAway: number | null;
  /** True when the earnings date could not be established at all. */
  earningsUnknown: boolean;
  /** Set when the chain could not be read. Produces `unknown` with this reason. */
  unreadable?: string;
}

/**
 * Grade one contract.
 *
 * Returns the badge and the reasons behind it, worst first. `reasons` is never
 * empty: a badge with no stated reason is a verdict the reader is being asked
 * to take on trust, and every other number on this page states its working.
 */
export function gradeContract(input: GradeInput): {
  badge: OptionQualityBadge;
  reasons: string[];
} {
  if (input.unreadable) {
    return { badge: 'unknown', reasons: [input.unreadable] };
  }

  const c = input.contract;
  if (!c) {
    return {
      badge: 'unknown',
      reasons: [
        `No call found between ${OPTION_WINDOW.minDte} and ${OPTION_WINDOW.maxDte} days out at a delta of ${OPTION_WINDOW.minDelta} to ${OPTION_WINDOW.maxDelta}.`,
      ],
    };
  }

  /*
   * Missing spread or missing open interest stops the grade dead. Both are
   * load-bearing: without the spread there is no cost of entry, and without
   * open interest there is no evidence anyone else is there. Grading on
   * whichever half did arrive would be a badge built from a coin toss.
   */
  const missing: string[] = [];
  if (c.spreadPctOfMid === null) missing.push('bid/ask spread');
  if (c.openInterest === null) missing.push('open interest');
  if (missing.length > 0) {
    return {
      badge: 'unknown',
      reasons: [
        `No ${missing.join(' and no ')} quoted for this contract, so it was not graded. An ungraded contract is not a safe one.`,
      ],
    };
  }

  const spread = c.spreadPctOfMid as number;
  const oi = c.openInterest as number;
  const t = QUALITY_THRESHOLDS;

  const reasons: string[] = [];

  // --- earnings, which can force the badge down on its own -------------------
  const earningsAvoid =
    input.earningsDaysAway !== null &&
    input.earningsDaysAway >= 0 &&
    input.earningsDaysAway <= 10;

  if (earningsAvoid) {
    reasons.push(
      `Earnings in ${input.earningsDaysAway} day${input.earningsDaysAway === 1 ? '' : 's'} — the contract reprices around the report whatever the stock does.`,
    );
  }

  // --- the two load-bearing measurements ------------------------------------
  let badge: OptionQualityBadge;

  if (spread > t.avoidAboveSpreadPct || oi < t.avoidBelowOi) {
    badge = 'avoid';
  } else if (spread <= t.excellent.maxSpreadPct && oi >= t.excellent.minOi) {
    badge = 'excellent';
  } else if (spread <= t.tradable.maxSpreadPct && oi >= t.tradable.minOi) {
    badge = 'tradable';
  } else {
    badge = 'caution';
  }

  if (earningsAvoid) badge = 'avoid';

  // --- the reasons, worst first ---------------------------------------------
  if (spread > t.avoidAboveSpreadPct) {
    reasons.push(
      `The bid/ask spread is ${spread.toFixed(1)}% of the contract's mid price. That cost is paid on entry, before the position does anything.`,
    );
  } else if (spread > t.tradable.maxSpreadPct) {
    reasons.push(
      `The bid/ask spread is ${spread.toFixed(1)}% of mid, which is wide.`,
    );
  } else if (spread <= t.excellent.maxSpreadPct) {
    reasons.push(`Tight bid/ask spread, ${spread.toFixed(1)}% of mid.`);
  } else {
    reasons.push(`Moderate bid/ask spread, ${spread.toFixed(1)}% of mid.`);
  }

  if (oi < t.avoidBelowOi) {
    reasons.push(
      `Only ${oi.toLocaleString('en-US')} contracts are open at this strike, so there may be nobody to sell it back to.`,
    );
  } else if (oi < t.tradable.minOi) {
    reasons.push(`Thin open interest, ${oi.toLocaleString('en-US')} contracts.`);
  } else if (oi >= t.excellent.minOi) {
    reasons.push(`High open interest, ${oi.toLocaleString('en-US')} contracts.`);
  } else {
    reasons.push(`Adequate open interest, ${oi.toLocaleString('en-US')} contracts.`);
  }

  if (c.ivPct !== null && c.ivPct > t.elevatedIvPct) {
    reasons.push(
      `Implied volatility is ${c.ivPct.toFixed(0)}%, which is elevated — the contract is priced for a large move.`,
    );
    // Elevated IV is a caution, never on its own an avoid: an expensive option
    // is a worse purchase, not an untradable one.
    if (badge === 'excellent' || badge === 'tradable') badge = 'caution';
  }

  if (
    input.earningsUnknown &&
    (badge === 'excellent' || badge === 'tradable')
  ) {
    /*
     * An unknown earnings date cannot be graded past `caution`. "Excellent"
     * beside a name that might report on Tuesday is a claim the data does not
     * support, and the reader has no way to tell the two apart from the badge.
     */
    badge = 'caution';
    reasons.push(
      'The earnings date could not be established, so a report inside the window cannot be ruled out.',
    );
  }

  return { badge, reasons };
}

/** Wrap a grade with its provenance. */
export function toQuality(
  input: GradeInput,
  meta: { source: OptionQualitySource; checkedAt: string; quoteDateIso: string | null },
): OptionQuality {
  const { badge, reasons } = gradeContract(input);
  return {
    badge,
    contract: input.unreadable ? null : input.contract,
    reasons,
    source: meta.source,
    checkedAt: meta.checkedAt,
    quoteDateIso: meta.quoteDateIso,
  };
}

/**
 * Pick the contract to grade out of everything in the window.
 *
 * Closest to the middle of the delta band, then tightest spread as the
 * tiebreak. Middle-of-band rather than highest-delta because the band is the
 * spec — a 0.70 delta is at its edge, and drifting to the edge every time
 * would quietly turn a 0.55-0.70 rule into a 0.70 rule.
 */
export function pickContract(candidates: OptionContract[]): OptionContract | null {
  const target = (OPTION_WINDOW.minDelta + OPTION_WINDOW.maxDelta) / 2;

  const inWindow = candidates.filter(
    (c) =>
      c.delta !== null &&
      c.delta >= OPTION_WINDOW.minDelta &&
      c.delta <= OPTION_WINDOW.maxDelta &&
      c.dte >= OPTION_WINDOW.minDte &&
      c.dte <= OPTION_WINDOW.maxDte,
  );

  if (inWindow.length === 0) return null;

  return inWindow.sort((a, b) => {
    const da = Math.abs((a.delta as number) - target);
    const db = Math.abs((b.delta as number) - target);
    if (Math.abs(da - db) > 0.01) return da - db;
    const sa = a.spreadPctOfMid ?? Number.POSITIVE_INFINITY;
    const sb = b.spreadPctOfMid ?? Number.POSITIVE_INFINITY;
    return sa - sb;
  })[0];
}

/** `45 DTE, 0.62 delta, 2,400 OI, 3.2% spread` — the numbers behind the badge. */
export function contractSummary(c: OptionContract | null): string {
  if (!c) return 'no contract in the window';
  const parts = [
    `${c.dte} DTE`,
    c.delta === null ? 'delta unknown' : `${c.delta.toFixed(2)} delta`,
    c.openInterest === null
      ? 'OI unknown'
      : `${c.openInterest.toLocaleString('en-US')} OI`,
    c.spreadPctOfMid === null
      ? 'spread unknown'
      : `${c.spreadPctOfMid.toFixed(1)}% spread`,
  ];
  return parts.join(', ');
}
