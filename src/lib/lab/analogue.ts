import 'server-only';

import { getAnalogues } from '../analogues';
import { LAB_ANALOGUE_HORIZON, type LabAnalogue } from './types';

/**
 * The analogue hit rate for one name, computed on demand.
 *
 * ## Why this is not on the page when it loads
 *
 * `getAnalogues` pulls the name's entire daily history — decades of bars — and
 * runs sixteen detectors over it. That is affordable per symbol and it is not
 * affordable five hundred and three times on a page view, and nothing stores
 * the result: the analogue engine deliberately recomputes forward returns on
 * every read, because a stored return ages against a series that gains a bar
 * every evening and the stale one looks exactly like the fresh one.
 *
 * So this page asks for the reading a batch at a time, when the reader asks,
 * and shows an absent component until then. Absent is the honest state — a
 * hit rate nobody looked up is not a hit rate of zero — and it is the reason
 * `score.ts` drops missing components instead of scoring them.
 *
 * ## "The current condition" is one condition, chosen and named
 *
 * A name can meet several conditions on the same session: down three closes,
 * below its Bollinger band and below its 200-day average are not exclusive.
 * Averaging their hit rates would be arithmetic over overlapping samples of
 * the same days, which is a number with no meaning.
 *
 * So one is picked — the active condition with the largest elapsed sample at
 * the horizon — and it is named on the row and in the expansion, along with
 * every other condition that was active and not used. A name that meets no
 * condition today has no reading rather than a bad one.
 */
export async function getLabAnalogue(symbol: string): Promise<LabAnalogue> {
  const view = await getAnalogues(symbol);

  const active = view.conditions.filter((condition) => condition.activeToday);

  const activeLabels = active.map((condition) => condition.label);

  if (active.length === 0) {
    return {
      conditionId: null,
      conditionLabel: null,
      activeLabels,
      positivePct: null,
      n: 0,
      thin: false,
      episodes: null,
      horizon: LAB_ANALOGUE_HORIZON,
      note: 'no condition is active on the latest session, so there is nothing to look the history up for',
    };
  }

  let best: (typeof active)[number] | null = null;
  let bestStats: { n: number; positivePct: number | null } | null = null;

  for (const condition of active) {
    const stats = condition.horizons.find((h) => h.horizon === LAB_ANALOGUE_HORIZON);
    if (!stats || stats.positivePct === null) continue;
    if (!bestStats || stats.n > bestStats.n) {
      best = condition;
      bestStats = { n: stats.n, positivePct: stats.positivePct };
    }
  }

  if (!best || !bestStats) {
    return {
      conditionId: active[0].id,
      conditionLabel: active[0].label,
      activeLabels,
      positivePct: null,
      n: 0,
      thin: false,
      episodes: null,
      horizon: LAB_ANALOGUE_HORIZON,
      note: `${active.length === 1 ? 'The one condition' : `All ${active.length} conditions`} active today matched too recently for a ${LAB_ANALOGUE_HORIZON}-session window to have elapsed, so there is no hit rate yet`,
    };
  }

  return {
    conditionId: best.id,
    conditionLabel: best.label,
    activeLabels,
    positivePct: bestStats.positivePct,
    n: bestStats.n,
    /*
     * Thin samples are scored and flagged rather than withheld. A ten-match
     * hit rate is a real reading of a small sample, and this page exists to be
     * looked at by eye — hiding the number would leave the row indistinguishable
     * from one nobody looked up, which is the one confusion it cannot afford.
     */
    thin: best.honesty.thin,
    /*
     * Episodes, not just matches. Matches within 42 sessions of each other are
     * the same stretch of market counted twice, so a hit rate over sixty
     * matches drawn from four episodes is worth about what four is worth.
     */
    episodes: best.honesty.episodes,
    horizon: LAB_ANALOGUE_HORIZON,
    note: null,
  };
}
