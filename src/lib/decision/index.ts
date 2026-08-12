import 'server-only';

import { getBars } from '../bars/intraday';
import { cached } from '../cache';
import { getPositioningForSymbol } from '../positioning';
import { normaliseSymbol } from '../ticker/bars';
import { buildConviction } from './conviction';
import type { DecisionContext, DecisionResult, Grade, Verdict, Wall } from './types';

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
    .filter((r) => Number.isFinite(r.gex) && Math.abs(r.gex) > 0);

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

  const stance =
    reds >= 2
      ? 'conditions are poor for trusting this level — wait for it to settle'
      : reds === 1
        ? 'conditions are mixed — let the chart show a trigger before acting'
        : 'conditions are supportive — wait for a chart trigger';

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

async function build(symbol: string): Promise<DecisionResult> {
  const positioning = await getPositioningForSymbol(symbol, EXPIRATIONS);
  const { summary, spot } = positioning;

  const walls = wallsFrom(positioning.rows, spot);

  const flipLevel = summary.flipLevel;
  const context: DecisionContext = {
    symbol: positioning.symbol,
    spot,
    regime: summary.regime,
    mood: summary.regime === 'positive' ? 'calm' : 'wild',
    flipLevel,
    aboveFlip: flipLevel === null ? null : spot > flipLevel,
    flipDistancePct:
      flipLevel === null || flipLevel === 0
        ? null
        : ((spot - flipLevel) / flipLevel) * 100,
    magnetAbove: walls.above[0] ?? null,
    magnetBelow: walls.below[0] ?? null,
    asOfLabel: positioning.meta.asOfLabel,
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
  try {
    bars = (await getBars(symbol, CONVICTION_TF)).bars;
  } catch {
    notes.push('Intraday bars were unavailable, so the conviction checks are blank.');
  }

  const conviction = buildConviction(bars, spot, level, side);
  const verdict = buildVerdict(context, conviction.checks);

  return {
    context,
    walls,
    conviction,
    verdict,
    hasOptions: walls.above.length > 0 || walls.below.length > 0,
    notes: [...notes, ...positioning.meta.notes],
  };
}

export class DecisionError extends Error {}

export async function getDecision(rawSymbol: string): Promise<DecisionResult> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) throw new DecisionError('That does not look like a US ticker.');

  return cached(`decision:${symbol}`, CACHE_SECONDS, () => build(symbol));
}
