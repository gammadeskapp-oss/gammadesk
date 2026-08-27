/**
 * The level map: every price level the chain justifies, on one ladder.
 *
 * The walls view answers "what is above me and what is below me". This answers
 * "what is the whole neighbourhood", including the two levels that are not
 * strikes at all — the gamma flip and the front week's own flip — which the
 * two wall lists have nowhere to put.
 *
 * Nothing here invents a level. Every rung is either a strike carrying gamma
 * we computed, a zero-crossing we solved for, or spot itself. Levels that
 * would need greeks this project does not derive are deliberately absent
 * rather than approximated.
 */

import {
  NEIGHBOURHOOD,
  STRONG_ENOUGH,
  nearestStrongWall,
  type StrikeGex,
} from '../simple/walls';
import type { Summary } from '../types';

/**
 * What a rung is claiming about its price.
 *
 * A single price can carry several of these at once — the heaviest wall on the
 * chain is very often also the ceiling — so they are collected per rung rather
 * than being mutually exclusive.
 */
export type LevelKind =
  | 'spot'
  | 'wall'
  | 'heaviest'
  | 'ceiling'
  | 'floor'
  | 'flip'
  | 'frontFlip';

export interface LevelRung {
  /** The price this rung sits at. */
  price: number;
  /** Every label this price earned, in a stable display order. */
  labels: LevelKind[];
  /**
   * Dollar gamma at this strike, or null when the rung is not a strike.
   *
   * The flip levels are solved positions on a continuous curve, not strikes,
   * so they have no open interest of their own to report. Spot likewise.
   */
  gex: number | null;
  /** True percentage distance from spot, signed. Zero at spot. */
  distancePct: number;
  /** Spot gets its own rendering, so the view does not have to sniff labels. */
  isSpot: boolean;
}

export interface LevelMap {
  /** Highest price first — the conventional ladder orientation. */
  rungs: LevelRung[];
  spot: number;
  /** Net dealer gamma across the full chain in scope. */
  netGex: number;
  /** Rungs that are not spot. */
  levelCount: number;
  /** The wall test actually applied, so the view can quote it exactly. */
  rule: {
    /** Share of the neighbourhood's biggest wall required, 0-1. */
    threshold: number;
    /** Strikes examined each side of spot. */
    neighbourhood: number;
  };
}

/**
 * Two flip levels closer together than this are the same level twice.
 *
 * Expressed as a share of spot rather than in dollars so it means the same
 * thing on a $5 name and a $600 one. A tenth of a percent is comfortably
 * inside the grid resolution `findGammaFlip` interpolates on, so a pair this
 * close is a rounding artefact rather than a real disagreement between the
 * front week and the full chain.
 */
const SAME_LEVEL_PCT = 0.001;

/** Order labels appear in when a rung carries more than one. */
const LABEL_ORDER: LevelKind[] = [
  'spot',
  'heaviest',
  'ceiling',
  'floor',
  'flip',
  'frontFlip',
  'wall',
];

/**
 * Strikes on one side that clear the neighbourhood's strength bar.
 *
 * The same test `nearestStrongWall` applies, run over the whole neighbourhood
 * instead of stopping at the first hit — so the map and the ceiling/floor can
 * never disagree about what counts as a wall.
 */
function wallsOnSide(
  rows: StrikeGex[],
  spot: number,
  side: 'above' | 'below',
): StrikeGex[] {
  const candidates = rows
    .filter((r) => Number.isFinite(r.gex) && Math.abs(r.gex) > 0)
    .filter((r) => (side === 'above' ? r.strike > spot : r.strike <= spot))
    .sort((a, b) => (side === 'above' ? a.strike - b.strike : b.strike - a.strike))
    .slice(0, NEIGHBOURHOOD);

  if (candidates.length === 0) return [];

  const biggest = Math.max(...candidates.map((c) => Math.abs(c.gex)));
  const bar = biggest * STRONG_ENOUGH;
  return candidates.filter((c) => Math.abs(c.gex) >= bar);
}

export function buildLevelMap(
  rows: StrikeGex[],
  spot: number,
  summary: Pick<Summary, 'netGex' | 'flipLevel' | 'frontFlipLevel'>,
): LevelMap {
  const usable = rows.filter((r) => Number.isFinite(r.gex) && Math.abs(r.gex) > 0);

  /*
   * Rungs are collected in a map keyed by price so a strike that is the
   * ceiling *and* the heaviest wall on the chain lands on one rung carrying
   * both labels, rather than appearing twice on the ladder.
   */
  const byPrice = new Map<number, LevelRung>();

  const add = (price: number, label: LevelKind, gex: number | null): void => {
    const existing = byPrice.get(price);
    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
      // Spot can land exactly on a strike (the lower side is inclusive), in
      // which case the rung already exists and still has to render as spot.
      if (label === 'spot') existing.isSpot = true;
      // A rung created by a flip has no gamma; if a strike later lands on the
      // same price, let the strike's figure fill it in.
      if (existing.gex === null && gex !== null) existing.gex = gex;
      return;
    }
    byPrice.set(price, {
      price,
      labels: [label],
      gex,
      distancePct: spot > 0 ? ((price - spot) / spot) * 100 : 0,
      isSpot: label === 'spot',
    });
  };

  // --- walls --------------------------------------------------------------
  for (const side of ['above', 'below'] as const) {
    for (const w of wallsOnSide(usable, spot, side)) add(w.strike, 'wall', w.gex);
  }

  // --- the single heaviest strike on the chain ----------------------------
  let heaviest: StrikeGex | null = null;
  for (const r of usable) {
    if (!heaviest || Math.abs(r.gex) > Math.abs(heaviest.gex)) heaviest = r;
  }
  if (heaviest) add(heaviest.strike, 'heaviest', heaviest.gex);

  // --- nearest strong wall each side --------------------------------------
  const ceiling = nearestStrongWall(usable, spot, 'above');
  if (ceiling) add(ceiling.strike, 'ceiling', ceiling.gex);

  const floor = nearestStrongWall(usable, spot, 'below');
  if (floor) add(floor.strike, 'floor', floor.gex);

  // --- the zero-gamma crossings -------------------------------------------
  if (summary.flipLevel !== null) add(summary.flipLevel, 'flip', null);

  /*
   * The front week only earns a rung when it actually says something different.
   * When the near expiry drives the whole crossing the two solve to the same
   * place, and two rungs a few cents apart would imply a disagreement that is
   * not there.
   */
  if (summary.frontFlipLevel !== null) {
    const sameAsFull =
      summary.flipLevel !== null &&
      spot > 0 &&
      Math.abs(summary.frontFlipLevel - summary.flipLevel) / spot < SAME_LEVEL_PCT;
    if (!sameAsFull) add(summary.frontFlipLevel, 'frontFlip', null);
  }

  // --- spot ---------------------------------------------------------------
  add(spot, 'spot', null);

  const rungs = [...byPrice.values()]
    .sort((a, b) => b.price - a.price)
    .map((r) => ({
      ...r,
      labels: LABEL_ORDER.filter((l) => r.labels.includes(l)),
    }));

  return {
    rungs,
    spot,
    netGex: summary.netGex,
    levelCount: rungs.filter((r) => !r.isSpot).length,
    rule: { threshold: STRONG_ENOUGH, neighbourhood: NEIGHBOURHOOD },
  };
}
