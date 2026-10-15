/**
 * Today's Playbook — the morning's single best-aligned shortlist, assembled from
 * the Daily 20 that is already built. It answers one question, honestly: of the
 * names that cleared the gate and ranked, which are in the best *place* to be
 * researched right now, and which are strong-but-badly-timed and belong on a
 * watch list instead.
 *
 * ## Alignment, not raw rank
 *
 * The research shortlist is ranked by an **Alignment** score, deliberately not
 * by the Daily 20's leadership total. A name can top the leaders list and still
 * be a poor place to start — run well above its 20-day, pinned against a gamma
 * level, or days from earnings. Alignment folds the leadership strength together
 * with how good today's setup is, how liquid it is, how much gamma room it has,
 * and how far it sits from the level that would invalidate the read. The weights
 * are named constants below.
 *
 * ## Hard exclusions, never a down-weight
 *
 * Two conditions remove a name from the research shortlist outright and route it
 * to the avoid/watch list instead — they are gates, not penalties the 10% risk
 * weight could outvote:
 *   1. a lifecycle state of Extended / Stretched / Damaged / Failed, and
 *   2. an imminent event — earnings inside the Daily 20's own risk window.
 * This is why the earnings case is gated explicitly rather than left to the
 * RiskHeadroom component: a name a week from earnings must not be able to buy
 * its way onto the shortlist with a strong enough score.
 *
 * ## Pure and feed-free
 *
 * It reads an assembled `Daily20` plus the spot/gamma context the caller already
 * has, and adds no data source. Every component of every Alignment score is
 * returned so the page can print the full breakdown — a score nobody can inspect
 * is a number a reader is being asked to trust. Nothing here says buy or sell.
 */

import type { Daily20, Daily20Entry, SetupState } from './daily20';
import type { LifecycleState } from './daily20Lifecycle';
import { researchPlan } from './researchPlan';
import { EVENT_WARN_DAYS } from './tickerRisk';

// --- the weights (confirmed; tune here) --------------------------------------

export type AlignmentComponentKey =
  | 'leadership'
  | 'setupQuality'
  | 'liquidity'
  | 'gammaRoom'
  | 'riskHeadroom';

/**
 * Alignment =
 *   0.30·Leadership + 0.30·SetupQuality + 0.15·Liquidity + 0.15·GammaRoom
 *   + 0.10·RiskHeadroom.
 *
 * They sum to 1, but nothing depends on it — `alignmentScore` renormalises over
 * the components a name actually has a reading for, exactly as `directionScore`
 * does, so a name with no wired gamma-room reading is not punished for it.
 */
export const ALIGNMENT_WEIGHTS: Record<AlignmentComponentKey, number> = {
  leadership: 0.3,
  setupQuality: 0.3,
  liquidity: 0.15,
  gammaRoom: 0.15,
  riskHeadroom: 0.1,
};

export const ALIGNMENT_COMPONENT_KEYS = [
  'leadership',
  'setupQuality',
  'liquidity',
  'gammaRoom',
  'riskHeadroom',
] as const;

export const ALIGNMENT_COMPONENT_LABEL: Record<AlignmentComponentKey, string> = {
  leadership: 'Leadership',
  setupQuality: 'Setup quality',
  liquidity: 'Liquidity',
  gammaRoom: 'Gamma room',
  riskHeadroom: 'Risk headroom',
};

/** Lifecycle states that bar a name from the research shortlist. */
export const EXCLUDED_LIFECYCLE: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  'extended',
  'stretched',
  'damaged',
  'failed',
]);

/** Earnings inside this many sessions hard-excludes from research. Mirrors the gate. */
export const EVENT_EXCLUDE_DAYS = EVENT_WARN_DAYS;

/** How many names on each of the two lists. */
export const PLAYBOOK_RESEARCH = 5;
export const PLAYBOOK_AVOID = 5;

// --- component readings ------------------------------------------------------

/** Linear map onto 0-100, clamped at both ends. Mirrors the score modules. */
function ramp(value: number, low: number, high: number): number {
  if (!(high > low)) return 0;
  return Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
}

/** Setup quality, 0-100, from where price sits in its own move. */
const SETUP_QUALITY: Record<SetupState, number> = {
  'breaking-out': 90,
  'breaking-down': 90,
  pullback: 80,
  neutral: 45,
  extended: 15,
  stretched: 15,
};

/** Liquidity, 0-100: the options-quality component, or turnover when no chain. */
function liquidityFor(entry: Daily20Entry): number | null {
  const opts = entry.score.components.options;
  if (opts !== null && Number.isFinite(opts)) return opts;
  const adv = entry.row.metrics.avgDollarVolume;
  if (adv > 0) return ramp(Math.log10(adv), Math.log10(20_000_000), Math.log10(2_000_000_000));
  return null;
}

/** Risk headroom, 0-100: how far the spot sits from the invalidation level. */
function riskHeadroomFor(entry: Daily20Entry, spot: number | null): number | null {
  const pct = researchPlan(entry, { spot: spot ?? entry.row.price }).invalidation.pct;
  if (pct === null || !Number.isFinite(pct)) return null;
  // At the level (0%) there is no headroom; ~12% away is plenty.
  return ramp(Math.abs(pct), 2, 12);
}

export type AlignmentComponents = Record<AlignmentComponentKey, number | null>;

export interface Alignment {
  /** 0-100, renormalised over the components that had a reading. */
  total: number;
  components: AlignmentComponents;
  /** Components with no reading, so the blend is reported honestly. */
  missing: AlignmentComponentKey[];
}

export interface PlaybookInputs {
  /** Per-symbol spot, for the risk-headroom distance. Falls back to row price. */
  spotBySymbol?: Map<string, number>;
}

function alignmentFor(entry: Daily20Entry, inputs: PlaybookInputs): Alignment {
  const spot = inputs.spotBySymbol?.get(entry.symbol) ?? entry.row.price;
  const components: AlignmentComponents = {
    leadership: Number.isFinite(entry.score.total) ? entry.score.total : null,
    setupQuality: SETUP_QUALITY[entry.setup] ?? null,
    liquidity: liquidityFor(entry),
    gammaRoom: entry.score.components.gammaRoom,
    riskHeadroom: riskHeadroomFor(entry, spot),
  };

  let weighted = 0;
  let totalWeight = 0;
  const missing: AlignmentComponentKey[] = [];
  for (const key of ALIGNMENT_COMPONENT_KEYS) {
    const v = components[key];
    if (v === null || !Number.isFinite(v)) {
      missing.push(key);
      continue;
    }
    weighted += v * ALIGNMENT_WEIGHTS[key];
    totalWeight += ALIGNMENT_WEIGHTS[key];
  }

  return { total: totalWeight > 0 ? weighted / totalWeight : 0, components, missing };
}

// --- exclusion ---------------------------------------------------------------

/** Is a report inside the exclusion window? */
function imminentEvent(entry: Daily20Entry): { excluded: boolean; label: string | null } {
  if (entry.gate.observations.earningsSoon) {
    const d = entry.row.earnings.daysAway;
    return { excluded: true, label: d !== null ? `earnings in ${d}d` : 'earnings imminent' };
  }
  const e = entry.row.earnings;
  if (e.state === 'known' && e.daysAway !== null && e.daysAway <= EVENT_EXCLUDE_DAYS) {
    return { excluded: true, label: `earnings in ${e.daysAway}d` };
  }
  return { excluded: false, label: null };
}

/**
 * Why a name is on the avoid/watch list rather than the research one — the first
 * applicable reason, stated plainly. Empty when nothing excludes it (it is on
 * the avoid list only to fill the five, as a weaker-aligned name).
 */
function exclusionReason(entry: Daily20Entry): string | null {
  const state = entry.lifecycle.state;
  if (state === 'extended') return 'extended above its 20-day — a worse place to start from';
  if (state === 'stretched') return 'stretched below its 20-day — prone to a snap-back';
  if (state === 'damaged') return 'a former leader whose setup has failed';
  if (state === 'failed') return 'has dropped out of leadership';
  const ev = imminentEvent(entry);
  if (ev.excluded) return ev.label;
  return null;
}

// --- the shortlist -----------------------------------------------------------

export interface PlaybookItem {
  entry: Daily20Entry;
  alignment: Alignment;
  /** The one-line, non-directional reason (the Daily 20 row's own line). */
  reason: string;
  /** The neutral watch line from the lifecycle. Always present. */
  watch: string;
  /** For the avoid list: why it is barred from research. Null on the research list. */
  excluded: string | null;
}

export interface Playbook {
  /** The five best-aligned names, after the hard exclusions. */
  research: PlaybookItem[];
  /** Five strong-but-mistimed or event-risk names, ranked by prominence. */
  avoid: PlaybookItem[];
  /** How many names were eligible for research before the top-five cut. */
  eligible: number;
}

function toItem(entry: Daily20Entry, alignment: Alignment): PlaybookItem {
  return {
    entry,
    alignment,
    reason: entry.reason,
    watch: entry.lifecycle.watch,
    excluded: exclusionReason(entry),
  };
}

/**
 * Assemble today's Playbook from an already-built Daily 20.
 *
 * Both sides of the Daily 20 feed in: a bearish laggard is as researchable a
 * short candidate as a bullish leader is a long one, so the shortlist spans
 * both. Research candidates are the names that survive the hard exclusions,
 * ranked by Alignment; the avoid list is the excluded names, ranked by their
 * leadership prominence so the most tempting mistimed names surface first.
 */
export function assemblePlaybook(daily20: Daily20, inputs: PlaybookInputs = {}): Playbook {
  const all = [...daily20.bullish, ...daily20.bearish];

  const scored = all.map((entry) => ({ entry, alignment: alignmentFor(entry, inputs) }));

  const researchable = scored.filter(
    ({ entry }) => !EXCLUDED_LIFECYCLE.has(entry.lifecycle.state) && !imminentEvent(entry).excluded,
  );
  const excluded = scored.filter(
    ({ entry }) => EXCLUDED_LIFECYCLE.has(entry.lifecycle.state) || imminentEvent(entry).excluded,
  );

  const research = [...researchable]
    .sort(
      (a, b) =>
        b.alignment.total - a.alignment.total ||
        a.entry.symbol.localeCompare(b.entry.symbol),
    )
    .slice(0, PLAYBOOK_RESEARCH)
    .map(({ entry, alignment }) => toItem(entry, alignment));

  const avoid = [...excluded]
    .sort(
      (a, b) =>
        b.entry.score.total - a.entry.score.total ||
        a.entry.symbol.localeCompare(b.entry.symbol),
    )
    .slice(0, PLAYBOOK_AVOID)
    .map(({ entry, alignment }) => toItem(entry, alignment));

  return { research, avoid, eligible: researchable.length };
}
