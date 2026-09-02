import { EARNINGS_EXCLUSION_DAYS, type EarningsInfo } from './types';

/**
 * The two pure rules about earnings dates.
 *
 * Split from `earnings.ts`, which is `server-only` because it fetches. These
 * are the parts that decide something, and they are the parts most worth
 * checking — `verify:scanner` walks them directly, which it could not do
 * through a module that pulls in the fetch path.
 */

/**
 * Whole calendar days between two `YYYY-MM-DD` strings.
 *
 * Both are parsed as UTC midnight so the difference is exact and never picks
 * up an off-by-one from a daylight-saving boundary — the scan runs at 09:35
 * New York, which is inside the window where a local-time subtraction drifts.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Whether a name is excluded for reporting too soon.
 *
 * Reads `state` first and `daysAway` second, on purpose. An unknown date can
 * never exclude and can never clear — it is passed through so the caller has
 * to render the uncertainty rather than resolve it silently. See
 * `EarningsInfo` for why that distinction is the whole point.
 *
 * The buffer is a parameter because it is one of the reader's controls now.
 * `EARNINGS_EXCLUSION_DAYS` remains the shipped default and the value the
 * archive and the run summary are recorded at, so "removed for earnings" in
 * the history means one fixed thing rather than whatever a slider happened to
 * be set to when someone looked.
 */
export function excludedForEarnings(
  info: EarningsInfo,
  bufferDays: number = EARNINGS_EXCLUSION_DAYS,
): boolean {
  if (info.state !== 'known' || info.daysAway === null) return false;
  return info.daysAway >= 0 && info.daysAway <= bufferDays;
}
