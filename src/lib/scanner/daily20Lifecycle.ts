/**
 * The lifecycle state — a single status per name that folds the two underlying
 * axes (leadership strength + today's setup) into one word a reader can act on,
 * each carrying a plain-English meaning and a neutral "what to watch" line.
 *
 * Leadership and setup remain the inputs and stay visible; this is the headline
 * they drive. Nothing here is an instruction — the watch line says what to look
 * for next (confirm it, wait for support, don't chase), never to buy or sell.
 *
 * "Damaged" and "Failed" need a prior run to detect — a leader whose setup has
 * broken, or one that has dropped out — so they are only produced when a prior
 * snapshot is supplied. From a single snapshot a name resolves to one of the
 * base states.
 */

import type { Daily20Entry, SetupState } from './daily20';
import type { Direction } from './directionScore';

export type LifecycleState =
  // bullish
  | 'emerging'
  | 'confirmed-leader'
  | 'breakout'
  | 'pullback'
  | 'extended'
  | 'damaged'
  | 'failed'
  // bearish
  | 'new-laggard'
  | 'confirmed-laggard'
  | 'breakdown'
  | 'stretched';

export interface Lifecycle {
  state: LifecycleState;
  /** Title-case label for the badge. */
  label: string;
  /** One sentence on what the state means. */
  meaning: string;
  /** The neutral next-thing-to-watch. Never an order. */
  watch: string;
}

const COPY: Record<LifecycleState, Omit<Lifecycle, 'state'>> = {
  emerging: {
    label: 'Emerging',
    meaning: 'Climbing the ranks but not yet a confirmed leader.',
    watch: 'Watchlist — wait for confirmation before researching.',
  },
  'confirmed-leader': {
    label: 'Confirmed leader',
    meaning: 'A confirmed leader holding its trend, no fresh trigger today.',
    watch: 'Research the setup; no entry trigger right now.',
  },
  breakout: {
    label: 'Breakout',
    meaning: 'Pushing up through its recent range with the trend intact.',
    watch: 'Check entry, risk and gamma room.',
  },
  pullback: {
    label: 'Pullback',
    meaning: 'Pulling back toward the 10/21/50-day while the uptrend holds.',
    watch: 'Watch for support to hold before it resumes.',
  },
  extended: {
    label: 'Extended',
    meaning: 'Run well above its 20-day average — a worse place to start from.',
    watch: 'Avoid chasing — wait for a pullback or a pause.',
  },
  damaged: {
    label: 'Damaged',
    meaning: 'A former leader whose setup has failed since the last run.',
    watch: 'Reassess — the leadership thesis is weakening.',
  },
  failed: {
    label: 'Failed',
    meaning: 'Has dropped out of leadership since the last run.',
    watch: 'Remove from the leaders list.',
  },
  'new-laggard': {
    label: 'New laggard',
    meaning: 'Newly among the weakest names in the index.',
    watch: 'Watchlist — confirm the breakdown before acting on it.',
  },
  'confirmed-laggard': {
    label: 'Confirmed laggard',
    meaning: 'A confirmed laggard, weak but with no fresh trigger today.',
    watch: 'Research the short setup; no trigger right now.',
  },
  breakdown: {
    label: 'Breakdown',
    meaning: 'Breaking down through support with the downtrend intact.',
    watch: 'Check risk and gamma room.',
  },
  stretched: {
    label: 'Stretched',
    meaning: 'Stretched far below its 20-day average — prone to a bounce.',
    watch: 'Avoid chasing — a snap-back is the near-term risk.',
  },
};

/** True when the leadership label is one of the strong tiers. */
function isStrong(leadership: string): boolean {
  return (
    leadership === 'Strong leader' ||
    leadership === 'Leader' ||
    leadership === 'Heavy laggard' ||
    leadership === 'Laggard'
  );
}

function baseState(direction: Direction, setup: SetupState, leadership: string): LifecycleState {
  if (direction === 'bullish') {
    if (leadership === 'Emerging leader') return 'emerging';
    if (setup === 'extended') return 'extended';
    if (setup === 'breaking-out') return 'breakout';
    if (setup === 'pullback') return 'pullback';
    return 'confirmed-leader';
  }
  if (leadership === 'Softening') return 'new-laggard';
  if (setup === 'stretched') return 'stretched';
  if (setup === 'breaking-down') return 'breakdown';
  return isStrong(leadership) ? 'confirmed-laggard' : 'new-laggard';
}

/**
 * Resolve a name's lifecycle state.
 *
 * With a `prior` entry the transitions that need history are detected first: a
 * bullish setup that failed since last run reads as `damaged`. (A name that has
 * left the Daily 20 entirely is `failed`, but that is decided by the change
 * feed, which can see the exits — not here, where only surviving entries are
 * passed.) Without a prior, the base state stands.
 */
export function lifecycleState(
  entry: Pick<Daily20Entry, 'direction' | 'setup' | 'leadership'>,
  prior?: Pick<Daily20Entry, 'setup'> | null,
): Lifecycle {
  let state = baseState(entry.direction, entry.setup, entry.leadership);

  if (prior && entry.direction === 'bullish') {
    const wasConstructive = prior.setup === 'breaking-out' || prior.setup === 'pullback';
    const nowBroken = entry.setup === 'neutral';
    if (wasConstructive && nowBroken) state = 'damaged';
  }

  return { state, ...COPY[state] };
}
