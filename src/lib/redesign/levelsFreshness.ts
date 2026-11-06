/**
 * Is the saved levels snapshot fresh enough to show as the current reading?
 *
 * The public Home reads the flip, magnets and gamma map from the Blob copy the
 * `/api/x/snapshot` cron rewrites every five minutes in session
 * (`gammadesk/positioning-spy.json`), while the spot beside them is a fresh
 * Cboe read on every request. If that cron stalls mid-session, the page would
 * keep printing an hours-old flip next to a live spot with nothing to say so.
 * This is the rule that stops it: in session, a snapshot past either bound is
 * stale and the page shows "data unavailable" instead of the old levels.
 *
 * Two clocks, because they fail differently:
 * - `builtAtIso` — when the cron computed it. Past `BUILT_MAX_AGE_MIN` means
 *   the job has stopped writing.
 * - `quoteDateIso` — when the market data inside it was recorded. Polygon's
 *   chain is 15 minutes delayed by plan, so this runs older than the build
 *   time; past `QUOTE_MAX_AGE_MIN` means the upstream itself froze even
 *   though the job kept running.
 *
 * Outside the session (after the close, weekends, holidays) the last snapshot
 * IS the answer, so nothing is ever stale here — the "as of" stamp tells the
 * reader which session it is from. Pre-open is handled upstream: a snapshot
 * built before a close that has since passed is already a cache miss
 * (`readCachedPositioning`).
 *
 * Pure (no imports) so `scripts/verify-levels-freshness.mjs` exercises exactly
 * this code.
 */

/** Five-minute cron, so this allows three missed runs plus the parse time. */
export const BUILT_MAX_AGE_MIN = 20;
/** Fifteen minutes of plan delay plus the same margin. */
export const QUOTE_MAX_AGE_MIN = 40;

export interface LevelsFreshnessInput {
  builtAtIso: string | null | undefined;
  quoteDateIso: string | null | undefined;
  /** True only during the regular session. */
  marketOpen: boolean;
  now?: Date;
}

export interface LevelsFreshness {
  stale: boolean;
  /** Minutes since the snapshot was built; null when unknown. */
  builtAgeMin: number | null;
  /** Minutes since the data inside it was recorded; null when unknown. */
  quoteAgeMin: number | null;
  /** Plain-English cause when stale, null otherwise. */
  reason: string | null;
}

function minutesSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((nowMs - at) / 60_000));
}

export function assessLevelsFreshness(input: LevelsFreshnessInput): LevelsFreshness {
  const nowMs = (input.now ?? new Date()).getTime();
  const builtAgeMin = minutesSince(input.builtAtIso, nowMs);
  const quoteAgeMin = minutesSince(input.quoteDateIso, nowMs);

  if (!input.marketOpen) return { stale: false, builtAgeMin, quoteAgeMin, reason: null };

  // In session, a timestamp we cannot read is not evidence of freshness.
  if (builtAgeMin === null) {
    return { stale: true, builtAgeMin, quoteAgeMin, reason: 'The snapshot has no readable build time.' };
  }
  if (builtAgeMin > BUILT_MAX_AGE_MIN) {
    return {
      stale: true,
      builtAgeMin,
      quoteAgeMin,
      reason: `The levels job last wrote ${builtAgeMin} min ago (limit ${BUILT_MAX_AGE_MIN}).`,
    };
  }
  if (quoteAgeMin === null) {
    return { stale: true, builtAgeMin, quoteAgeMin, reason: 'The snapshot has no readable market-data time.' };
  }
  if (quoteAgeMin > QUOTE_MAX_AGE_MIN) {
    return {
      stale: true,
      builtAgeMin,
      quoteAgeMin,
      reason: `The market data in the snapshot is ${quoteAgeMin} min old (limit ${QUOTE_MAX_AGE_MIN}).`,
    };
  }
  return { stale: false, builtAgeMin, quoteAgeMin, reason: null };
}
