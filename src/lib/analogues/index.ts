import 'server-only';

import { cached } from '../cache';
import { CONDITIONS, detect } from './conditions';
import { fetchDeepBars } from './deepBars';
import { buildBaseline, summarise } from './forward';
import type { AnaloguesView, ConditionId } from './types';

export { CONDITIONS, conditionById, detect } from './conditions';
export { buildBaseline, LONGEST, THIN_SAMPLE } from './forward';
export {
  comparisonSentence, horizonLabel, overlapSentence, verdictFor,
  CLEAR_GAP_PP, MEANINGFUL_GAP_PP, POSITIVE_DEADBAND_PP, SMALL_GAP_PP,
  type Comparison, type Verdict,
} from './phrasing';
export { fetchDeepBars } from './deepBars';
export { HORIZONS } from './types';
export type {
  AnaloguesView, BaselineStats, Bar, ConditionId, ConditionResult, Coverage, Horizon,
  HorizonStats, Match, Outcome,
} from './types';

/**
 * Historical analogues for one symbol.
 *
 * A lookup over stored daily closes and nothing else: no options data, no
 * model output, no forecast. Every number on the page is a count or a quantile
 * of what actually happened after a past session that met the same test.
 *
 * Match dates are the only thing derived from the conditions; the returns
 * beside them are recomputed here on every read. That is deliberate — a stored
 * return would age against a series that gets one more bar every evening, and
 * the stale one would look exactly like the fresh one.
 */
export function getAnalogues(symbol: string): Promise<AnaloguesView> {
  return cached(`analogues:${symbol.toUpperCase()}`, 3600, async () => {
    const { bars, coverage } = await fetchDeepBars(symbol);

    const conditions = CONDITIONS.map((def) =>
      summarise(def, bars, detect(bars, def.id)),
    );

    return {
      coverage,
      baseline: buildBaseline(bars),
      conditions,
      active: conditions
        .filter((c) => c.activeToday)
        .map((c) => c.id as ConditionId),
    };
  });
}
