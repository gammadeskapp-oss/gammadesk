/**
 * The Daily 20 scorecard — a transparent record of what the list did next, not
 * a marketing win-rate.
 *
 * Pure statistics over already-priced listings: the loader turns each stored
 * listing into forward returns (close-to-close at 1/5/10/20 sessions) and the
 * window's best/worst close (MFE/MAE from daily closes), and this module
 * aggregates them — hit rate AND median return per horizon, with the
 * breakdowns that make the number honest: by gamma regime, by sector, by setup,
 * by new-entry vs continuing, and for names that carried the "extended"
 * warning.
 *
 * ## Direction-aware, and it says both numbers
 *
 * A "hit" for a bullish leader is an up move; for a bearish laggard it is a
 * down move. The hit rate is therefore direction-aware. The median return is
 * reported raw (not flipped), because a scorecard that silently flips signs is
 * the kind of thing this page exists to avoid — the sign is information. Both
 * numbers are shown; neither is a claim about the future.
 */

import type { Direction } from './directionScore';
import type { SetupState } from './daily20';

/** The horizons, in trading sessions. */
export const HORIZONS = [1, 5, 10, 20] as const;
export type Horizon = (typeof HORIZONS)[number];

/** One listing, priced by the loader. Returns are fractions (0.05 = +5%). */
export interface ScoredListing {
  date: string;
  symbol: string;
  direction: Direction;
  setup: SetupState;
  regime: 'positive' | 'negative' | null;
  sector: string | null;
  extended: boolean;
  /** True when the name was not in the previous session's Daily 20. */
  newEntry: boolean;
  /** Forward close-to-close return per horizon; null where the window is incomplete. */
  ret: Record<Horizon, number | null>;
  /** Max favourable / adverse excursion over the longest window, from closes. Null when short. */
  mfe: number | null;
  mae: number | null;
}

export interface HorizonStat {
  /** Listings with a return at this horizon. */
  n: number;
  /** Share whose move went the listed way (up for leaders, down for laggards), 0-100. */
  hitRate: number | null;
  /** Median raw return, as a fraction. Sign preserved. */
  median: number | null;
  /** Mean raw return, as a fraction. */
  mean: number | null;
}

export interface Breakdown {
  key: string;
  label: string;
  n: number;
  /** Stat at each horizon for this slice. */
  byHorizon: Record<Horizon, HorizonStat>;
}

export interface Scorecard {
  /** Listings that had at least one measurable horizon. */
  sampled: number;
  overall: Record<Horizon, HorizonStat>;
  /** Median MFE and MAE over the longest window. */
  mfeMedian: number | null;
  maeMedian: number | null;
  byRegime: Breakdown[];
  bySetup: Breakdown[];
  byDirection: Breakdown[];
  byNewVsContinuing: Breakdown[];
  byExtended: Breakdown[];
  bySector: Breakdown[];
}

// --- small stats -------------------------------------------------------------

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** A hit is a move the listed way: up for a leader, down for a laggard. */
function isHit(direction: Direction, ret: number): boolean {
  return direction === 'bullish' ? ret > 0 : ret < 0;
}

function horizonStat(listings: ScoredListing[], h: Horizon): HorizonStat {
  const withRet = listings.filter((l) => l.ret[h] !== null);
  const rets = withRet.map((l) => l.ret[h] as number);
  const hits = withRet.filter((l) => isHit(l.direction, l.ret[h] as number)).length;
  return {
    n: withRet.length,
    hitRate: withRet.length ? (hits / withRet.length) * 100 : null,
    median: median(rets),
    mean: mean(rets),
  };
}

function statsByHorizon(listings: ScoredListing[]): Record<Horizon, HorizonStat> {
  const out = {} as Record<Horizon, HorizonStat>;
  for (const h of HORIZONS) out[h] = horizonStat(listings, h);
  return out;
}

function breakdown(
  listings: ScoredListing[],
  keyOf: (l: ScoredListing) => string | null,
  labelOf: (key: string) => string,
): Breakdown[] {
  const groups = new Map<string, ScoredListing[]>();
  for (const l of listings) {
    const key = keyOf(l);
    if (key === null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(l);
    else groups.set(key, [l]);
  }
  return [...groups.entries()]
    .map(([key, ls]) => ({ key, label: labelOf(key), n: ls.length, byHorizon: statsByHorizon(ls) }))
    .sort((a, b) => b.n - a.n);
}

export function computeScorecard(listings: ScoredListing[]): Scorecard {
  const sampled = listings.filter((l) => HORIZONS.some((h) => l.ret[h] !== null));

  const mfes = sampled.map((l) => l.mfe).filter((x): x is number => x !== null);
  const maes = sampled.map((l) => l.mae).filter((x): x is number => x !== null);

  return {
    sampled: sampled.length,
    overall: statsByHorizon(sampled),
    mfeMedian: median(mfes),
    maeMedian: median(maes),
    byRegime: breakdown(
      sampled,
      (l) => l.regime,
      (k) => (k === 'positive' ? 'Positive gamma' : 'Negative gamma'),
    ),
    bySetup: breakdown(sampled, (l) => l.setup, (k) => k.replace('-', ' ')),
    byDirection: breakdown(
      sampled,
      (l) => l.direction,
      (k) => (k === 'bullish' ? 'Leaders' : 'Laggards'),
    ),
    byNewVsContinuing: breakdown(
      sampled,
      (l) => (l.newEntry ? 'new' : 'continuing'),
      (k) => (k === 'new' ? 'New entry' : 'Continuing'),
    ),
    byExtended: breakdown(
      sampled,
      (l) => (l.extended ? 'extended' : 'not-extended'),
      (k) => (k === 'extended' ? 'Flagged extended' : 'Not extended'),
    ),
    bySector: breakdown(sampled, (l) => l.sector, (k) => k),
  };
}
