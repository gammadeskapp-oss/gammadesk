/**
 * The sentences the breadth card says out loud.
 *
 * Kept apart from the counting and from the rendering, for the same reason
 * `lib/tooltips.ts` exists: the wording is the feature. Someone rewording this
 * file should not have to read arithmetic, and someone changing the arithmetic
 * should not be able to change what the page claims by accident.
 *
 * The rules every string here follows:
 *
 *   - No undefined jargon. "Breadth" never appears in a sentence without the
 *     sentence explaining it, because the number is useless to a reader who
 *     does not know the word.
 *   - Say the meaning, not the number. "34%" alone tells a beginner nothing;
 *     "only a third of the 500 biggest US companies are up today" tells them
 *     everything.
 *   - Nothing about the future. "Selling is broad" describes now. "Likely to
 *     fall further" is a forecast, and this feature does not make them.
 *   - Sentences stay under about twenty words.
 */

import type { BreadthSample, EqualWeightSpread } from './types';

/**
 * A percentage as a fraction a person would actually say.
 *
 * "A third of the class" is immediately legible; "34%" needs converting in the
 * reader's head first, and the whole point of the sentence is that it should
 * not need converting.
 */
export function fractionWords(pct: number): string {
  if (pct < 8) return 'almost none';
  if (pct < 20) return 'about one in six';
  if (pct < 29) return 'about a quarter';
  if (pct < 40) return 'about a third';
  if (pct < 46) return 'a little under half';
  if (pct <= 54) return 'about half';
  if (pct < 62) return 'a little over half';
  if (pct < 71) return 'about two thirds';
  if (pct < 80) return 'about three quarters';
  if (pct < 92) return 'most';
  return 'nearly all';
}

/** The headline sentence: what the number means, in one short sentence. */
export function breadthSentence(sample: BreadthSample): string {
  const words = fractionWords(sample.pctAbovePriorClose);
  const { measured } = sample.counts;
  return `${words} of the ${measured} biggest US companies are above yesterday's closing price.`;
}

/**
 * What the two-fund cross-check says, in plain words.
 *
 * Never "bullish" or "bearish". The same positive gap appears on a strong day
 * led by a few giants and on a weak day where the giants are the ones falling,
 * so the sentence describes participation and stops there.
 */
export function spreadSentence(spread: EqualWeightSpread): string {
  const rsp = `${spread.rspPct >= 0 ? '+' : ''}${spread.rspPct.toFixed(2)}%`;
  const spy = `${spread.spyPct >= 0 ? '+' : ''}${spread.spyPct.toFixed(2)}%`;
  const figures = `(equal-weight fund ${rsp}, index fund ${spy})`;

  if (spread.shape === 'even') {
    return `The average company is moving roughly with the index ${figures}.`;
  }
  if (spread.shape === 'broad') {
    return `The average company is doing worse than the index ${figures}.`;
  }
  return `The index is being carried by a few large companies ${figures}.`;
}

/**
 * The one-word-ish summary under the number.
 *
 * "Broad" and "narrow" are the only two claims made, and both are about how
 * many are joining in — not about direction, and not about what happens next.
 */
export function participationWords(sample: BreadthSample): string {
  const pct = sample.pctAbovePriorClose;
  if (pct > 60) return 'Buying is broad — most companies are joining in.';
  if (pct < 40) return 'Selling is broad — most companies are joining in.';
  return 'Companies are split roughly evenly today.';
}

/** How the fifteen-minute reading is phrased when it exists. */
export function recentSentence(sample: BreadthSample): string | null {
  if (sample.pctGreen15m === null) return null;
  const words = fractionWords(sample.pctGreen15m);
  return `Right now ${words} are higher than they were fifteen minutes ago.`;
}
