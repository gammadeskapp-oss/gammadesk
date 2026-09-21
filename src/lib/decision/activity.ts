/**
 * Matching the two weightings, so the Standard view can say which of its levels
 * today's trading also backs.
 *
 * The open-interest ladder and the volume ladder are built by the same code
 * over the same snapshot; this decides when a rung on one is "the same level"
 * as a rung on the other. A level a trader would size against is a price, so
 * the answer is a list of standard prices that the volume view also calls a
 * level — nothing more interpreted than that.
 *
 * Two rules, because the two kinds of level are established differently:
 *
 *   - A strike is confirmed only by the same strike. Gamma sits on the listed
 *     ladder, so 765 in one view and 765 in the other is the same wall; 765 and
 *     766 are two different strikes and neither confirms the other.
 *
 *   - A flip is a solved zero-crossing on a continuous curve, so it is never
 *     bit-for-bit equal across two books. It is confirmed when the volume
 *     view's crossing lands within a tenth of a percent of spot of it — the
 *     same tolerance `levelMap` uses to decide the front week and the full
 *     chain are the same crossing, for the same reason.
 *
 * A strike never confirms a flip or the other way round: they are different
 * claims about the price and collapsing them would invent agreement.
 */

import type { LevelKind, LevelMap, LevelRung } from './levelMap';

/**
 * A flip crossing within this share of spot of another is the same level.
 * Matches `SAME_LEVEL_PCT` in `levelMap.ts` — the grid `findGammaFlip`
 * interpolates on is coarser than this, so a closer pair is a rounding
 * artefact, not a real disagreement.
 */
const SAME_LEVEL_PCT = 0.001;

/** Labels that only ever sit on a real strike. */
const STRIKE_LABELS: readonly LevelKind[] = ['wall', 'heaviest', 'ceiling', 'floor'];
/** Labels that are solved crossings rather than strikes. */
const FLIP_LABELS: readonly LevelKind[] = ['flip', 'frontFlip'];

function isStrikeRung(rung: LevelRung): boolean {
  return rung.labels.some((l) => STRIKE_LABELS.includes(l));
}

function isFlipRung(rung: LevelRung): boolean {
  return rung.labels.some((l) => FLIP_LABELS.includes(l));
}

/**
 * Standard-view level prices that the volume view also calls a level.
 *
 * Returned as prices drawn from the standard ladder, so a caller can tag its
 * own rungs and walls by simple membership. Spot is never a level and is never
 * returned. An absent or empty volume ladder confirms nothing.
 */
export function confirmedByVolume(
  standard: LevelMap,
  activity: LevelMap | null,
  spot: number,
): number[] {
  if (!activity) return [];

  const activityStrikes = new Set(
    activity.rungs.filter((r) => !r.isSpot && isStrikeRung(r)).map((r) => r.price),
  );
  const activityFlips = activity.rungs
    .filter((r) => !r.isSpot && isFlipRung(r))
    .map((r) => r.price);

  const confirmed: number[] = [];

  for (const rung of standard.rungs) {
    if (rung.isSpot) continue;

    if (isStrikeRung(rung) && activityStrikes.has(rung.price)) {
      confirmed.push(rung.price);
      continue;
    }

    if (
      isFlipRung(rung) &&
      spot > 0 &&
      activityFlips.some((p) => Math.abs(p - rung.price) / spot < SAME_LEVEL_PCT)
    ) {
      confirmed.push(rung.price);
    }
  }

  return confirmed;
}
