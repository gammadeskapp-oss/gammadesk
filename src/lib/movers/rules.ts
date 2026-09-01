import { EXTENDED_PCT, type EarningsInfo } from '../scanner/types';
import {
  HIGH_RELATIVE_VOLUME,
  MIN_RELATIVE_VOLUME,
  type MoverWarning,
  type TrendPosition,
} from './types';

/**
 * The decisions the movers list makes, with nothing else in the file.
 *
 * Split out of `compute.ts` for the same reason `scanner/earningsRules.ts` is
 * split out of `scanner/earnings.ts`: that module is `server-only` and fetches,
 * so a verification script cannot reach into it, and these are precisely the
 * parts most worth checking. `verify:movers` walks every function here.
 *
 * Three rules, and the asymmetry between them is the whole design:
 *
 * - `qualifies` is the ONLY thing that removes a name.
 * - `trendFrom` and `warningsFor` only describe. Nothing they return has ever
 *   shortened this list, and a change here must never be able to.
 */

/** Reports today or tomorrow. */
export const EARNINGS_WARN_DAYS = 1;

/**
 * Whether a name belongs on the list at all.
 *
 * Strictly greater than the threshold, so a name sitting exactly at average
 * volume plus a half is not "above 1.5 times". `null` inputs never qualify:
 * a name whose baseline is not stored has not passed this gate, it has not
 * been put to it, and admitting it would make the one gate optional.
 */
export function qualifies(
  changePct: number,
  volume: number | null,
  avgVolume20: number | null,
): boolean {
  if (!(changePct > 0)) return false;
  if (volume === null || avgVolume20 === null) return false;
  if (!Number.isFinite(volume) || !(avgVolume20 > 0)) return false;
  return volume / avgVolume20 > MIN_RELATIVE_VOLUME;
}

/**
 * Where a live price sits against a stored 200-day average.
 *
 * A missing average is `unknown` and never `below`. The two would render
 * identically to a careless eye and mean opposite things — one is a fact about
 * the stock, the other is a gap in this project's shards.
 */
export function trendFrom(last: number, ema200: number | null): TrendPosition {
  if (ema200 === null || !(ema200 > 0) || !Number.isFinite(last)) return 'unknown';
  return last >= ema200 ? 'above' : 'below';
}

/** Percent above or below an average. Null when the average is unusable. */
export function pctFrom(last: number, average: number | null): number | null {
  if (average === null || !(average > 0) || !Number.isFinite(last)) return null;
  return ((last - average) / average) * 100;
}

/**
 * Everything true about a row that a reader should check.
 *
 * Every one of these is shown and none is applied. Returning an empty array is
 * a legitimate answer — a name above its 200-day, not extended, on ordinary
 * volume, with a known earnings date that is not imminent, has nothing to flag
 * and must not be given a filler badge to look balanced.
 *
 * An absent or unknown earnings reading produces `earnings-unknown`, never
 * silence. This is the single most important line in the file: "we could not
 * find out" and "there is nothing soon" are different statements, and only one
 * of them is safe to leave off a row.
 */
export function warningsFor(input: {
  trend: TrendPosition;
  pctFrom20: number | null;
  relativeVolume: number;
  earnings: EarningsInfo | undefined;
}): MoverWarning[] {
  const warnings: MoverWarning[] = [];
  const { trend, pctFrom20, relativeVolume, earnings } = input;

  if (!earnings || earnings.state !== 'known' || earnings.daysAway === null) {
    warnings.push('earnings-unknown');
  } else if (earnings.daysAway >= 0 && earnings.daysAway <= EARNINGS_WARN_DAYS) {
    warnings.push('earnings');
  }

  if (trend === 'below') warnings.push('below-200');

  // An unreadable 20-day average is not extended, matching `readExtension` in
  // the scanner. A warning made entirely out of a gap in the data is worse
  // than no warning.
  if (pctFrom20 !== null && pctFrom20 > EXTENDED_PCT) warnings.push('extended');

  if (relativeVolume >= HIGH_RELATIVE_VOLUME) warnings.push('volume-spike');

  return warnings;
}

/**
 * The list order: percent change, descending.
 *
 * A comparator rather than an inline arrow so the verification script can
 * assert that nothing else — not volume, not relative strength, not the
 * warning count — has quietly become a tiebreaker. The list is ordered by the
 * one thing it claims to be ordered by.
 */
export function byChangeDescending(
  a: { changePct: number },
  b: { changePct: number },
): number {
  return b.changePct - a.changePct;
}
