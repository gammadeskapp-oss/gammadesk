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

/**
 * Percentage points of 42-day median gap before the headline verdict stops
 * saying "about the same".
 *
 * Deliberately the same number as `CLEAR_GAP_PP` — one threshold decides both
 * the headline and the detail line, so the two can never disagree in front of
 * the reader. It is printed on the page beside the verdict, because a reader
 * who cannot see the threshold cannot judge the word that came out of it.
 *
 * It is a presentation cutoff. It is not a test, and the page says so.
 */
export const MEANINGFUL_GAP_PP = CLEAR_GAP_PP;

/**
 * How far the percent-positive gap must move before it counts as pointing
 * anywhere at all.
 *
 * Percent-positive is displayed rounded to whole points, so a gap of a few
 * tenths is a difference the reader cannot see. Without this deadband a
 * condition sitting a rounding error below the baseline would be announced as
 * contradicting itself.
 */
export const POSITIVE_DEADBAND_PP = 1;

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
    `After ${midSentence(condition.label)}, the typical result over ` +
    `${horizonLabel(horizon)} was ${asPct(stats.medianReturn)}, across ` +
    `${stats.n} ${stats.n === 1 ? 'time' : 'times'}. On a normal day it came ` +
    `to ${asPct(base.medianReturn)}.`;

  /*
   * A thin sample gets no verdict on the size of the gap. Describing a gap
   * built on nine observations as "clear" would be the page contradicting its
   * own "pattern, not proof" label two lines above.
   */
  if (condition.honesty.thin) {
    return {
      text:
        `${opening} Too few past examples here to tell either way.`,
      horizon,
      gapPp,
    };
  }

  const size = Math.abs(gapPp);
  const direction = gapPp > 0 ? 'ahead' : 'behind';
  let verdict: string;

  if (size < SMALL_GAP_PP) {
    verdict = 'Little difference between the two.';
  } else if (size < CLEAR_GAP_PP) {
    verdict = `The pattern came out a little ${direction}.`;
  } else {
    verdict = `The pattern came out clearly ${direction}.`;
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
    `This happened ${count} times, but they came in clumps — about ` +
    `${episodes} separate ${episodes === 1 ? 'stretch' : 'stretches'}. So it ` +
    `is really ${episodes} ${episodes === 1 ? 'story' : 'stories'}, not ` +
    `${count}.`
  );
}

/** Horizons in the reader's units, with the session count kept alongside. */
export function horizonLabel(horizon: number): string {
  switch (horizon) {
    case 1: return '1 day';
    case 5: return '1 week';
    case 10: return '2 weeks';
    case 21: return '1 month';
    case 42: return '2 months';
    default: return `${horizon} sessions`;
  }
}

export interface Verdict {
  tone: 'nothing' | 'better' | 'worse';
  /** The headline sentence. */
  text: string;
  /**
   * The second line, always present: the two go-up rates in plain words. When
   * the two measures point opposite ways it says so instead of picking one.
   */
  detail: string;
  /** Percent-positive, condition and baseline, always shown beneath. */
  condPositive: number;
  basePositive: number;
  gapPp: number;
  horizon: number;
}

/**
 * The headline read, in the plainest words the figures support.
 *
 * Three shapes only, chosen by the 42-day median gap against
 * `MEANINGFUL_GAP_PP`. The percent-positive comparison is not folded into that
 * choice — it is printed underneath instead, every time, in both directions.
 *
 * That split is deliberate and it matters. Drawdown crossing -10% has a median
 * 2.7 points above the baseline while going up *less* often than a random day
 * (61% against 67%). Folding both into one word would have to either suppress
 * one of those facts or invent a fourth shape the brief does not have. Printing
 * the second line always means the mixed case shows up as a mixed case, in
 * figures, directly under the word.
 *
 * A thin sample never earns "better" or "worse" however large its gap: with
 * fewer than ten examples the gap is a coincidence with a number attached, and
 * the headline says exactly that rather than describing its size.
 */
export function verdictFor(
  condition: ConditionResult,
  baseline: BaselineStats[],
): Verdict | null {
  if (condition.matches.length === 0) return null;

  const usable = condition.horizons
    .filter((h) => {
      const b = baseline.find((x) => x.horizon === h.horizon);
      return (
        h.n > 0 && h.medianReturn !== null && h.positivePct !== null &&
        b && b.medianReturn !== null && b.positivePct !== null
      );
    })
    .sort((a, b) => b.horizon - a.horizon);

  const stats = usable[0];
  if (!stats || stats.medianReturn === null || stats.positivePct === null) {
    return null;
  }
  const base = baseline.find((x) => x.horizon === stats.horizon);
  if (!base || base.medianReturn === null || base.positivePct === null) {
    return null;
  }

  const gapPp = (stats.medianReturn - base.medianReturn) * 100;
  const up = stats.positivePct.toFixed(0);
  const normalUp = base.positivePct.toFixed(0);
  const against =
    `It went up ${up}% of the time, against ${normalUp}% on a normal day.`;

  const shared = {
    condPositive: stats.positivePct,
    basePositive: base.positivePct,
    gapPp,
    horizon: stats.horizon,
  };

  if (condition.honesty.thin) {
    return {
      ...shared,
      tone: 'nothing',
      text: `This has only happened ${condition.matches.length} times — too ` +
        'few to tell.',
      detail: against,
    };
  }

  /*
   * When the two measures point opposite ways, the headline picks neither.
   *
   * Being 10% down from the 12-month high on SPY is the case: its typical
   * result comes out ahead while it goes UP less often, 61% against 67%. A
   * headline saying "did better than normal" would be true of one measure and
   * false of the other, with nothing telling the reader which one it came
   * from. So it is called mixed and both facts are stated.
   *
   * Only checked when the typical result would otherwise have picked a side.
   * Below that threshold the headline already says nothing special happened,
   * and announcing a contradiction between two flat numbers would be noise.
   */
  const positiveGapPp = stats.positivePct - base.positivePct;
  const resultPicksSide = Math.abs(gapPp) >= MEANINGFUL_GAP_PP;
  const positivePoints = Math.abs(positiveGapPp) >= POSITIVE_DEADBAND_PP;

  if (
    resultPicksSide && positivePoints &&
    Math.sign(gapPp) !== Math.sign(positiveGapPp)
  ) {
    const resultBetter = gapPp > 0;
    return {
      ...shared,
      tone: 'nothing',
      text: 'This one is mixed — the numbers point different ways.',
      detail:
        `Its typical result was ${resultBetter ? 'better' : 'worse'} than ` +
        `normal, but it went up ${resultBetter ? 'less' : 'more'} often — ` +
        `${up}% of the time, against ${normalUp}% on a normal day.`,
    };
  }

  if (gapPp >= MEANINGFUL_GAP_PP) {
    return {
      ...shared,
      tone: 'better',
      text: 'The market usually did better than normal after this.',
      detail: against,
    };
  }

  if (gapPp <= -MEANINGFUL_GAP_PP) {
    return {
      ...shared,
      tone: 'worse',
      text: 'The market usually did worse than normal after this.',
      detail: against,
    };
  }

  return {
    ...shared,
    tone: 'nothing',
    text: 'Nothing special happened after this.',
    detail:
      `The market went up ${up}% of the time — about the same as it usually ` +
      'does.',
  };
}

/**
 * What an episode is, in one line.
 *
 * Shared by the sidebar and the table so the two cannot drift apart. The word
 * survives the plain-language sweep because there is no shorter honest
 * substitute — "stretches" alone loses that they are separated in time — but
 * it never appears without this sentence within reach.
 */
export const EPISODE_NOTE =
  'Episodes are separate stretches of market, not single days: several times ' +
  'close together count as one.';
