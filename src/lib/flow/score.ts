/*
 * The flow screen's scoring, flagging and plain-language notes.
 *
 * Pure on purpose — no `server-only`, no fetch, no clock. `compute.ts` is
 * server-only and does the fetching; everything a reader actually sees about a
 * row (its 0–100 score, its flag, its one-line note) is decided here so it can
 * be imported by the client table AND exercised by `verify:flow` without the
 * chain machinery attached. Same split as `spyRspCore.ts`.
 */

import { formatUsd } from '../format';
import {
  EXTREME_PREMIUM_USD,
  EXTREME_RATIO,
  FAR_OTM_PCT,
  HUGE_VOLUME,
  LARGE_PREMIUM_USD,
  SCORE_FLOOR_PREMIUM_USD,
  SCORE_FULL_PREMIUM_USD,
} from './types';
import type { FlowFlag } from './types';

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface ScoreInput {
  /** Dollars that changed hands, or null when no price was usable. */
  premium: number | null;
  /** volume / open interest. */
  volumeToOi: number;
  /** Signed percent the strike sits from spot. */
  distancePct: number;
}

/**
 * The "Unusual score", 0–100.
 *
 * A blend of the three things that make a print worth a second look, weighted
 * towards money because that is what the screen now ranks by:
 *
 *   - size in dollars (55) — log-scaled between the display floor ($50k) and a
 *     genuinely huge print ($50M), so a $1M and a $2M print are not pinned to
 *     the same top of the scale.
 *   - volume versus open interest (30) — the classic unusualness measure, full
 *     marks by 20×.
 *   - nearness to spot (15) — an at-the-money print is more likely to be a real
 *     directional or hedging decision than a 40%-out lottery ticket, which is
 *     usually one leg of a spread.
 *
 * Deliberately not a probability of anything. It is a sort key with a number
 * attached, and the page says so.
 */
export function unusualScore(input: ScoreInput): number {
  const premium = input.premium ?? 0;
  const premiumComp =
    premium > 0
      ? clamp01(
          Math.log10(premium / SCORE_FLOOR_PREMIUM_USD) /
            Math.log10(SCORE_FULL_PREMIUM_USD / SCORE_FLOOR_PREMIUM_USD),
        )
      : 0;
  const ratioComp = clamp01(input.volumeToOi / 20);
  const distanceComp = clamp01(1 - Math.abs(input.distancePct) / 15);

  const score = 55 * premiumComp + 30 * ratioComp + 15 * distanceComp;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * The flag on a row, or null for no flag.
 *
 * Only two now, and both require real money:
 *   - EXTREME: trading more than ten times its open interest AND more than $1M
 *     changed hands. Both conditions, because a 50× ratio on a $20k contract is
 *     noise and a $1M print at 2× is ordinary flow — the flag is for when both
 *     the ratio and the dollars are large at once.
 *   - LARGE: more than $250k changed hands, whatever the ratio.
 * Anything else carries no flag rather than a reassuring-looking label.
 */
export function flagFor(input: { volumeToOi: number; premium: number | null }): FlowFlag {
  const premium = input.premium ?? 0;
  if (input.volumeToOi >= EXTREME_RATIO && premium >= EXTREME_PREMIUM_USD) {
    return 'extreme';
  }
  if (premium >= LARGE_PREMIUM_USD) return 'large';
  return null;
}

/**
 * Where the strike sits, in a word or two. Shared by the note and the
 * multi-leg test so they can never disagree about what "at the money" means.
 */
function wherePhrase(distancePct: number): string {
  if (Math.abs(distancePct) < 1) return 'at the money';
  const side = distancePct > 0 ? 'above' : 'below';
  return `${Math.round(Math.abs(distancePct))}% ${side} spot`;
}

export interface NoteInput {
  premium: number | null;
  volume: number;
  openInterest: number;
  volumeToOi: number;
  type: 'call' | 'put';
  distancePct: number;
}

/**
 * The "What happened" line: about twelve words, dollars first.
 *
 * e.g. "$14.1M of puts, 164x usual size, at the money."
 *
 * Says what moved and how big, never why. No word here implies a direction or
 * an intent — a large put print is not a "bearish bet", because the feed cannot
 * see whether it was bought, sold, or hedged (the page states this up top).
 */
export function shortNote(input: NoteInput): string {
  const side = input.type === 'call' ? 'calls' : 'puts';
  const where = wherePhrase(input.distancePct);

  // "usual size" = how many times the contract's own open interest traded. Only
  // worth saying when it is actually a multiple; below 1× it is not the story.
  const sizePart =
    input.volumeToOi >= 1
      ? `${
          input.volumeToOi >= 10 ? Math.round(input.volumeToOi) : input.volumeToOi.toFixed(1)
        }x usual size`
      : null;

  if (input.premium !== null && input.premium > 0) {
    const dollars = formatUsd(input.premium);
    return sizePart
      ? `${dollars} of ${side}, ${sizePart}, ${where}.`
      : `${dollars} of ${side}, ${where}.`;
  }

  // No usable price: fall back to the counts, still short.
  const vol = input.volume.toLocaleString('en-US');
  return sizePart
    ? `${vol} ${side}, ${sizePart}, ${where}.`
    : `${vol} ${side}, ${where}.`;
}

/**
 * The multi-leg caveat, or null.
 *
 * A contract more than halfway out from spot that still trades heavily is
 * almost never a standalone directional trade — it is usually the far wing of a
 * spread or a risk-reversal, booked here as if it were one print because the
 * feed shows no ticket structure. Flagging it keeps a beginner from reading a
 * 60%-OTM block as a conviction bet.
 */
export function multiLegNote(input: { distancePct: number; volume: number }): string | null {
  if (Math.abs(input.distancePct) > FAR_OTM_PCT && input.volume >= HUGE_VOLUME) {
    return 'Likely part of a larger multi-leg trade.';
  }
  return null;
}
