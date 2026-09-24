import 'server-only';

import { createJsonStore } from '../jsonStore';
import { nextDueAfter, type IntradayState, type LockedLevels, type TriggerKey } from './intradaySchedule';

/**
 * Durable state for the intraday cadence: when the next timed update may fire,
 * and which level breaks have already posted today. Lives in Blob so a redeploy
 * mid-day does not reset the pacing or re-fire a break. Kept apart from the pure
 * scheduling logic in `intradaySchedule.ts` so that module stays testable.
 */

const stateStore = createJsonStore<IntradayState>(
  'gammadesk/x-intraday.json',
  () => ({ date: '', nextDueIso: null, triggersPosted: [], usedPhrases: [], summarySent: false }),
  (raw) => {
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as IntradayState).date === 'string' &&
      Array.isArray((raw as IntradayState).triggersPosted)
    ) {
      const r = raw as IntradayState;
      return { ...r, usedPhrases: Array.isArray(r.usedPhrases) ? r.usedPhrases : [] };
    }
    return null;
  },
);

/**
 * Today's intraday state, reset to empty when the stored day is not today's —
 * so a new session starts fresh without a nightly clear job.
 */
export async function readIntradayState(date: string): Promise<IntradayState> {
  const stored = await stateStore.read().catch(() => null);
  if (stored && stored.date === date) return stored;
  return { date, nextDueIso: null, triggersPosted: [], usedPhrases: [], summarySent: false };
}

/**
 * Record that an intraday post went out: advance the timer, mark the break and
 * phrase, throttle the wild wording, and lock the day's levels if not already.
 */
export async function recordIntradayPost(
  date: string,
  now: Date,
  opts: {
    trigger: TriggerKey | null;
    phraseId?: string | null;
    /** True when the post used "wild/bigger moves" wording — anchors the 1/hour throttle. */
    wild?: boolean;
    /** The day's levels to lock, if the morning post did not already lock them. */
    lockedLevels?: LockedLevels;
  },
): Promise<void> {
  try {
    const current = await readIntradayState(date);
    const triggersPosted = opts.trigger
      ? [...new Set([...current.triggersPosted, opts.trigger])]
      : current.triggersPosted;
    const usedPhrases = opts.phraseId
      ? [...new Set([...current.usedPhrases, opts.phraseId])]
      : current.usedPhrases;
    await stateStore.write({
      ...current,
      date,
      nextDueIso: nextDueAfter(now),
      triggersPosted,
      usedPhrases,
      // Lock the levels once — the first post of the day that carries them wins.
      lockedLevels: current.lockedLevels ?? opts.lockedLevels,
      lastWildIso: opts.wild ? now.toISOString() : current.lastWildIso,
    });
  } catch {
    // Best effort — the log's once-a-day guard still stops a same-key repost.
  }
}

/**
 * Lock the day's flip/support/resistance at the morning post. Locks once: a
 * later call (e.g. a redeploy replaying the morning) does not move them.
 */
export async function recordLockedLevels(date: string, levels: LockedLevels): Promise<void> {
  try {
    const current = await readIntradayState(date);
    if (current.lockedLevels) return;
    await stateStore.write({ ...current, date, lockedLevels: levels });
  } catch {
    // Best effort — an unlocked day just falls back to the live levels.
  }
}

/** Mark that today's 4:30 CT summary email has been sent. */
export async function markSummarySent(date: string): Promise<void> {
  try {
    const current = await readIntradayState(date);
    await stateStore.write({ ...current, date, summarySent: true });
  } catch {
    // Best effort — a missed mark only risks a duplicate summary, never a post.
  }
}

/** Record that the market-hours stale-data alert just fired (throttle anchor). */
export async function markStaleAlerted(date: string, now: Date): Promise<void> {
  try {
    const current = await readIntradayState(date);
    await stateStore.write({ ...current, date, staleAlertedAt: now.toISOString() });
  } catch {
    // Best effort — a missed mark only risks an extra alert, never a post.
  }
}
