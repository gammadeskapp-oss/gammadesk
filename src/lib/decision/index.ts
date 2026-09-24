import 'server-only';

import { getBars } from '../bars/intraday';
import type { PositioningData } from '../types';
import { cached } from '../cache';
import { getPositioningForSymbol } from '../positioning';
import { getSpotQuote } from '../spot';
import { clearsSpotDeadZone, nearestStrongWall } from '../simple/walls';
import { formatExpiryLabel } from '../time';
import { normaliseSymbol } from '../ticker/bars';
import { getTradeability } from '../ticker/liquidity';
import { confirmedByVolume } from './activity';
import { buildConviction } from './conviction';
import { buildLevelMap } from './levelMap';
import type {
  ActivityLevels,
  DecisionContext,
  DecisionResult,
  Grade,
  Verdict,
  Wall,
} from './types';

export type { DecisionResult } from './types';

/** Expirations folded into the wall list. The near book is what price feels. */
const EXPIRATIONS = 5;
/** Walls listed each side. */
const WALLS_PER_SIDE = 4;
/** Timeframe the conviction checks are measured on. */
const CONVICTION_TF = '5m' as const;
/** Everything on the page is delayed anyway; this only stops a refresh storm. */
const CACHE_SECONDS = 120;

function wallsFrom(
  rows: { strike: number; total: { gex: number } }[],
  spot: number,
): { above: Wall[]; below: Wall[] } {
  const scored = rows
    .map((r) => ({ strike: r.strike, gex: r.total.gex }))
    .filter((r) => Number.isFinite(r.gex) && Math.abs(r.gex) > 0)
    // Exclude the strikes essentially on top of spot, the same dead-zone the
    // ceiling/floor rule uses — so the Ceilings/Floors list and the level map's
    // CEILING/FLOOR badges lead with the same strike rather than one of them
    // naming a level a few cents off spot.
    .filter((r) => clearsSpotDeadZone(r.strike, spot));

  const pick = (side: 'above' | 'below'): Wall[] => {
    const candidates = scored
      .filter((r) => (side === 'above' ? r.strike > spot : r.strike <= spot))
      // Nearest first: a huge wall five percent away matters less to the next
      // hour than a moderate one right overhead.
      .sort((a, b) =>
        side === 'above' ? a.strike - b.strike : b.strike - a.strike,
      )
      .slice(0, WALLS_PER_SIDE);

    const biggest = Math.max(...candidates.map((c) => Math.abs(c.gex)), 0);

    return candidates.map((c) => ({
      strike: c.strike,
      gex: c.gex,
      strength: biggest > 0 ? Math.abs(c.gex) / biggest : 0,
      distancePct: spot > 0 ? ((c.strike - spot) / spot) * 100 : 0,
    }));
  };

  return { above: pick('above'), below: pick('below') };
}

/**
 * The one plain-English line.
 *
 * Built from the parts rather than picked from a list of canned sentences, so
 * it cannot describe a combination that is not actually on screen. It never
 * says buy or sell — it says what the conditions are and, when the reads
 * disagree, that they disagree.
 */
function buildVerdict(context: DecisionContext, checks: { grade: Grade }[]): Verdict {
  const regimeWords =
    context.mood === 'calm'
      ? 'Calm regime, moves tend to fade'
      : 'Wild regime, moves tend to run';

  const flipWords =
    context.aboveFlip === null
      ? 'no flip level nearby'
      : context.aboveFlip
        ? 'price above the flip'
        : 'price below the flip';

  if (checks.length === 0) {
    return {
      line: `${regimeWords}, ${flipWords}. Not enough intraday data to judge the move into the nearest level.`,
      conflict: null,
      tone: 'amber',
    };
  }

  const reds = checks.filter((c) => c.grade === 'red').length;
  const greens = checks.filter((c) => c.grade === 'green').length;

  const quality =
    reds >= 2
      ? 'the move into it looks stretched'
      : reds === 1
        ? 'the move into it is mixed'
        : greens === 3
          ? 'a fresh level after a contained move'
          : 'the move into it is reasonable';

  // Worded so the stance never repeats the quality phrase it follows.
  const stance =
    reds >= 2
      ? 'poor conditions for trusting this level, wait for it to settle'
      : reds === 1
        ? 'not clean enough to lean on, let the chart show a trigger first'
        : 'conditions supportive, wait for a chart trigger';

  /*
   * The interesting case is disagreement, and it is worth naming rather than
   * averaging away. A calm regime with a stretched approach is a genuinely
   * different picture from a calm regime with a clean one.
   */
  let conflict: string | null = null;
  if (context.mood === 'calm' && reds >= 2) {
    conflict =
      'The regime says moves should fade here, but the approach to this level was stretched. Those point in opposite directions.';
  } else if (context.mood === 'wild' && greens === 3) {
    conflict =
      'The level reads clean, but the regime says moves tend to run rather than stall. A wild tape can go straight through a good level.';
  } else if (context.aboveFlip === false && context.mood === 'calm') {
    conflict =
      'The regime reads calm while price sits below the flip, which is where it usually stops being calm. Treat the regime as fragile.';
  }

  const tone: Grade = reds >= 2 ? 'red' : reds === 1 ? 'amber' : 'green';

  return {
    line: `${regimeWords}, ${flipWords}, ${quality} — ${stance}.`,
    conflict,
    tone,
  };
}

/** Wraps a raw strike as a `Wall`, with strength relative to itself. */
function asWall(hit: { strike: number; gex: number } | null, spot: number): Wall | null {
  if (!hit) return null;
  return {
    strike: hit.strike,
    gex: hit.gex,
    strength: 1,
    distancePct: spot > 0 ? ((hit.strike - spot) / spot) * 100 : 0,
  };
}

/**
 * The volume-weighted twin of the standard levels, off the same snapshot.
 *
 * Returns null only when the volume pass could not be built at all. When it ran
 * but nothing had traded this session, `available` is false and the walls and
 * ladder are simply empty — a normal pre-open state, not a failure.
 */
function buildActivity(volume: PositioningData): ActivityLevels {
  const { summary, spot } = volume;
  const strikeGex = volume.rows.map((r) => ({ strike: r.strike, gex: r.total.gex }));
  const available = strikeGex.some(
    (s) => Number.isFinite(s.gex) && Math.abs(s.gex) > 0,
  );

  return {
    available,
    walls: wallsFrom(volume.rows, spot),
    levelMap: buildLevelMap(strikeGex, spot, summary),
    flipLevel: summary.flipLevel,
    frontFlipLevel: summary.frontFlipLevel,
    frontExpiryLabel: summary.frontExpiration
      ? formatExpiryLabel(summary.frontExpiration)
      : null,
  };
}

async function build(symbol: string): Promise<DecisionResult> {
  /*
   * Open interest and volume, built from one shared chain snapshot (see
   * `cachedSymbolSnapshot`), so the second weighting costs no upstream request.
   * The volume pass is allowed to fail on its own — the page is the
   * open-interest page, and losing the secondary view is not worth losing it.
   */
  const [positioning, volumePositioning] = await Promise.all([
    getPositioningForSymbol(symbol, EXPIRATIONS),
    getPositioningForSymbol(symbol, EXPIRATIONS, 'volume').catch(
      (): PositioningData | null => null,
    ),
  ]);
  const { summary, spot } = positioning;

  /*
   * `spot` is the chain snapshot's own price, on the many-minute chain cache. It
   * is used below to *build* and *classify* the levels — which strikes count as
   * walls, which side of the flip they sit on — so those stay stable within a
   * cache window and do not flicker as price wobbles.
   *
   * `displaySpot` is a live quote on its own short cache (see `lib/spot.ts`),
   * used for what the reader is quoted: the price itself and its distance to the
   * flip and the walls. So the levels come from the (cheap, stable) chain and
   * the price tracks the tape. Falls back to the chain spot if the live quote
   * is unavailable.
   */
  const live = await getSpotQuote(symbol).catch(() => null);
  const displaySpot = live?.price ?? spot;

  const walls = wallsFrom(positioning.rows, spot);
  const strikeGex = positioning.rows.map((r) => ({
    strike: r.strike,
    gex: r.total.gex,
  }));
  const levelMap = buildLevelMap(strikeGex, spot, summary);

  const activity = volumePositioning ? buildActivity(volumePositioning) : null;
  const confirmed = confirmedByVolume(levelMap, activity?.levelMap ?? null, spot);

  const flipLevel = summary.flipLevel;
  const context: DecisionContext = {
    symbol: positioning.symbol,
    spot: displaySpot,
    regime: summary.regime,
    mood: summary.regime === 'positive' ? 'calm' : 'wild',
    flipLevel,
    frontFlipLevel: summary.frontFlipLevel,
    frontExpiryLabel: summary.frontExpiration
      ? formatExpiryLabel(summary.frontExpiration)
      : null,
    aboveFlip: flipLevel === null ? null : displaySpot > flipLevel,
    flipDistancePct:
      flipLevel === null || flipLevel === 0
        ? null
        : ((displaySpot - flipLevel) / flipLevel) * 100,
    // Nearest *strong*, shared with the simple view so the two cannot
    // disagree about where price stalls — see lib/simple/walls.ts. The wall is
    // *selected* off the chain spot (stable), its distance measured to the live
    // price (current).
    magnetAbove: asWall(nearestStrongWall(strikeGex, spot, 'above'), displaySpot),
    magnetBelow: asWall(nearestStrongWall(strikeGex, spot, 'below'), displaySpot),
    asOfLabel: positioning.meta.asOfLabel,
    quoteDateLabel: positioning.meta.quoteDateLabel,
    quoteDateIso: positioning.meta.quoteDateIso,
  };

  // Whichever wall price is closer to is the one the move is heading into.
  const above = context.magnetAbove;
  const below = context.magnetBelow;
  let level: number | null = null;
  let side: 'above' | 'below' | null = null;

  if (above && below) {
    const toAbove = Math.abs(above.strike - spot);
    const toBelow = Math.abs(spot - below.strike);
    if (toAbove <= toBelow) {
      level = above.strike;
      side = 'above';
    } else {
      level = below.strike;
      side = 'below';
    }
  } else if (above) {
    level = above.strike;
    side = 'above';
  } else if (below) {
    level = below.strike;
    side = 'below';
  }

  const notes: string[] = [];
  let bars: Awaited<ReturnType<typeof getBars>>['bars'] = [];

  /*
   * Intraday bars and the tradeability assessment are independent of each
   * other and of everything above, so they go out together. Tradeability
   * resolves to null on failure rather than throwing — it is a gate on what
   * the page may show, not a reason to lose the page.
   */
  const [intraday, liquidity] = await Promise.all([
    getBars(symbol, CONVICTION_TF).catch(() => null),
    getTradeability(symbol),
  ]);

  if (intraday) {
    bars = intraday.bars;
  } else {
    notes.push('Intraday bars were unavailable, so the conviction checks are blank.');
  }

  const conviction = buildConviction(bars, spot, level, side);
  const verdict = buildVerdict(context, conviction.checks);

  return {
    context,
    walls,
    // Built from the same rows and the same wall rule as the lists above, so
    // the two views of section 2 cannot contradict each other.
    levelMap,
    activity,
    confirmedByVolume: confirmed,
    conviction,
    verdict,
    hasOptions: walls.above.length > 0 || walls.below.length > 0,
    liquidity,
    notes: [...notes, ...positioning.meta.notes],
  };
}

export class DecisionError extends Error {}

export async function getDecision(rawSymbol: string): Promise<DecisionResult> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) throw new DecisionError('That does not look like a US ticker.');

  return cached(`decision:${symbol}`, CACHE_SECONDS, () => build(symbol));
}
