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
 * Everything the /decision regime tile shows, from one function.
 *
 * ## Why this exists rather than three calls at the call site
 *
 * That tile has two inputs, not one. The option chain says which side of the
 * flip spot sits on right now; the level feed says which crossing of it was
 * last confirmed on one-minute bars. They normally agree. When the chain has
 * just been re-solved they can disagree for a refresh or two, and the tile has
 * to say so rather than silently picking a winner.
 *
 * Composing that at the call site would mean the page deciding some of the
 * wording and this file deciding the rest — which is exactly the split that
 * let the dashboard and the decision page drift to NEGATIVE and WILD in the
 * first place. So the disagreement state is a parameter here, and the page
 * renders what it is given.
 *
 * @param chain     What the option chain says, which is the current reading.
 * @param observed  What the level feed last confirmed, or null when there is
 *   no feed reading to compare against. Passing the same value as `chain` is
 *   agreement, not disagreement.
 */
export interface RegimeDisplay {
  /** The headline. Always the chain's reading — it is the live one. */
  value: string;
  /** The line under it. */
  sub: string;
  /** Amber when the two sources disagree, so the conflict is visible. */
  tone: 'pos' | 'neg' | 'flip';
  /** Whether the two sources disagree, for anything that needs to branch. */
  disagrees: boolean;
}

export function regimeDisplay(
  chain: Regime,
  observed: Regime | null = null,
): RegimeDisplay {
  const disagrees = observed !== null && observed !== chain;

  return {
    // The chain is what the tile reports either way. The feed's reading is a
    // caveat on it, not a replacement for it: the feed describes a crossing
    // that has already happened, the chain describes where spot sits now.
    value: regimeLabel(chain),
    sub: disagrees
      ? `Level feed last saw a flip to ${regimeWord(observed)}. The two readings disagree.`
      : regimeSubLine(chain),
    tone: disagrees ? 'flip' : regimeTone(chain),
    disagrees,
  };
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
