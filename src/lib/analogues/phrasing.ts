import type { BaselineStats, ConditionResult } from './types';

/**
 * The one-line read of a condition against the baseline, in plain English.
 *
 * ## Why this is a pure module and not JSX
 *
 * It is the only sentence on the page that draws a conclusion, so it is the
 * only place that could overstate one. Generated from the two figures it
 * quotes, and driven by `verify:analogues` with hand-built numbers, so the
 * wording at each size of gap is pinned rather than left to whatever a
 * template happened to produce.
 *
 * ## What it will not say
 *
 * No action, no recommendation, no significance test, no score. It states the
 * two medians and characterises the distance between them. "Followed by" is
 * the strongest verb available to it; there is deliberately no phrasing for
 * "worth trading" because there is no number here that could support one.
 *
 * A gap is also not evidence on its own — a large gap on nine matches is a
 * coincidence with a big number attached. So the sentence carries the match
 * count, and when the sample is thin it says the gap cannot be read rather
 * than describing its size.
 */

/**
 * Percentage-point gaps below this are called no difference; above the second,
 * a gap is stated without hedging. Between them it is explicitly called small.
 *
 * These are presentation thresholds, not statistics. They decide wording only,
 * and the raw numbers sit in the table directly above regardless.
 */
export const SMALL_GAP_PP = 0.5;
export const CLEAR_GAP_PP = 1.5;

function signedPp(pp: number): string {
  return `${pp > 0 ? '+' : ''}${pp.toFixed(1)}`;
}

function asPct(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

/**
 * Lower-cases a condition label for mid-sentence use, leaving acronyms alone.
 * "RSI(14) closes below 30" must not become "rSI(14)…".
 */
function midSentence(label: string): string {
  const [first, ...rest] = label.split(' ');
  const looksLikeAcronym = /[A-Z]{2,}/.test(first);
  return [looksLikeAcronym ? first : first.toLowerCase(), ...rest].join(' ');
}

export interface Comparison {
  /** The finished sentence. */
  text: string;
  /** Horizon it speaks about — the longest with data on both sides. */
  horizon: number;
  /** Condition median less baseline median, in percentage points. */
  gapPp: number;
}

/**
 * The comparison sentence, or null when there is nothing honest to say —
 * no matches, or no horizon where both sides have a figure.
 */
export function comparisonSentence(
  condition: ConditionResult,
  baseline: BaselineStats[],
): Comparison | null {
  if (condition.matches.length === 0) return null;

  /*
   * The longest horizon that both sides can answer. Longest because that is
   * where drift does the most work and where the baseline is therefore most
   * worth stating — a 1-day median is near zero for everything.
   */
  const usable = condition.horizons
    .filter((h) => {
      const b = baseline.find((x) => x.horizon === h.horizon);
      return h.n > 0 && h.medianReturn !== null && b && b.medianReturn !== null;
    })
    .sort((a, b) => b.horizon - a.horizon);

  const stats = usable[0];
  if (!stats || stats.medianReturn === null) return null;

  const base = baseline.find((x) => x.horizon === stats.horizon);
  if (!base || base.medianReturn === null) return null;

  const gapPp = (stats.medianReturn - base.medianReturn) * 100;
  const horizon = stats.horizon;

  const opening =
    `After ${midSentence(condition.label)}, the ${horizon}-day median was ` +
    `${asPct(stats.medianReturn)} across ${stats.n} ` +
    `${stats.n === 1 ? 'match' : 'matches'}. Any random ${horizon}-day ` +
    `window was ${asPct(base.medianReturn)}.`;

  /*
   * A thin sample gets no verdict on the size of the gap. Describing a gap
   * built on nine observations as "clear" would be the page contradicting its
   * own "pattern, not proof" label two lines above.
   */
  if (condition.honesty.thin) {
    return {
      text:
        `${opening} Too few matches here to read the difference either way.`,
      horizon,
      gapPp,
    };
  }

  const size = Math.abs(gapPp);
  let verdict: string;

  if (size < SMALL_GAP_PP) {
    verdict = 'Little difference here.';
  } else if (size < CLEAR_GAP_PP) {
    verdict =
      gapPp > 0
        ? `The condition ran ${signedPp(gapPp)} points above the baseline, a small gap.`
        : `The condition ran ${signedPp(gapPp)} points below the baseline, a small gap.`;
  } else {
    verdict =
      gapPp > 0
        ? `The condition ran ${signedPp(gapPp)} points above the baseline.`
        : `The condition ran ${signedPp(gapPp)} points below the baseline.`;
  }

  return { text: `${opening} ${verdict}`, horizon, gapPp };
}

/**
 * The overlap caveat, naming the condition that clusters.
 *
 * Leads with the episode count because that is the figure a reader can act on
 * mentally — "37 readings" is a sample size, "411 overlapping" is a property
 * of the data they then have to do arithmetic on.
 */
export function overlapSentence(condition: ConditionResult): string | null {
  const { honesty, matches } = condition;
  if (honesty.overlapping === 0) return null;

  const count = matches.length;
  const { episodes } = honesty;

  return (
    `These ${count} matches come from about ${episodes} separate ` +
    `${episodes === 1 ? 'episode' : 'episodes'} — ` +
    `${midSentence(condition.label)} clusters together, so this is closer to ` +
    `${episodes} independent ${episodes === 1 ? 'reading' : 'readings'} ` +
    `than ${count}.`
  );
}
