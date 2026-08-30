/**
 * One set of words for the gamma regime, used by every surface that shows it.
 *
 * ## Why this file exists
 *
 * The dashboard said NEGATIVE and the decision page said WILD, for the same
 * state. Two words for one reading is not a style problem — a first-time
 * reader reasonably assumes they are two different measurements, and goes
 * looking for the disagreement between them.
 *
 * The fix is not to rename each site; it is to have exactly one place that
 * decides, so the two can never drift apart again. Nothing else should spell
 * these words out.
 *
 * ## The chosen form
 *
 * Plain word first, technical word in brackets:
 *
 *   CALM (positive gamma)   dealers dampen moves
 *   WILD (negative gamma)   dealers amplify moves
 *
 * The plain word is what a reader who has never traded needs. The bracket is
 * what makes the page searchable and lets someone who already knows the term
 * connect it to everything else written about gamma. Neither alone does both
 * jobs.
 *
 * ## Two traps
 *
 * **1. "CALM" is also a downturn-risk label.** `lib/forecast/risk.ts` grades
 * crash risk as CALM / CAUTIOUS / DEFENSIVE, and /daily shows it as
 * "Downturn". That is a completely different reading that happens to share a
 * word. It must never be given a "(positive gamma)" gloss, and it is not
 * routed through this file.
 *
 * **2. The simple read's mood is not the regime.** `lib/simple/translate.ts`
 * calls a day wild when the regime is negative *or* when price is below the
 * flip, so a positive-gamma day below the flip reads as wild there. Stamping
 * "(negative gamma)" on that would be a false statement about the book. That
 * view deliberately keeps the bare plain word — see the note there.
 */

/** How dealer hedging is leaning, as every stored payload spells it. */
export type Regime = 'positive' | 'negative';

/** The plain-English half, on its own. For places with no room for the gloss. */
export function regimeWord(regime: Regime): 'CALM' | 'WILD' {
  return regime === 'positive' ? 'CALM' : 'WILD';
}

/** The technical half, on its own. */
export function regimeGloss(regime: Regime): string {
  return `${regime} gamma`;
}

/**
 * The full label — `CALM (positive gamma)` — which is what surfaces should
 * show unless there is a specific reason not to.
 */
export function regimeLabel(regime: Regime): string {
  return `${regimeWord(regime)} (${regimeGloss(regime)})`;
}

/**
 * The line that sits under the label.
 *
 * Says what dealers do, because that is the only reason the regime matters.
 * It describes behaviour, never a direction price will go.
 */
export function regimeSubLine(regime: Regime): string {
  return regime === 'positive' ? 'dealers dampen moves' : 'dealers amplify moves';
}

/**
 * The existing colour token for a regime, unchanged from what each surface
 * already used. Here so the colour cannot drift from the word either.
 */
export function regimeTone(regime: Regime): 'pos' | 'neg' {
  return regime === 'positive' ? 'pos' : 'neg';
}

/**
 * The regime behind a `calm`/`wild` mood, for payloads that carry the mood.
 *
 * Only safe where the mood was derived from the regime alone — which is true
 * of `lib/decision`, and NOT true of `lib/simple/translate`. See trap 2 above.
 */
export function regimeOfMood(mood: 'calm' | 'wild'): Regime {
  return mood === 'calm' ? 'positive' : 'negative';
}
