import 'server-only';

import { createJsonStore } from '../jsonStore';
import { nextDueAfter, type IntradayState, type TriggerKey } from './intradaySchedule';

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

/** Record that an intraday post went out: advance the timer, mark the break and phrase. */
export async function recordIntradayPost(
  date: string,
  now: Date,
  trigger: TriggerKey | null,
  phraseId?: string | null,
): Promise<void> {
  try {
    const current = await readIntradayState(date);
    const triggersPosted = trigger
      ? [...new Set([...current.triggersPosted, trigger])]
      : current.triggersPosted;
    const usedPhrases = phraseId
      ? [...new Set([...current.usedPhrases, phraseId])]
      : current.usedPhrases;
    await stateStore.write({ ...current, date, nextDueIso: nextDueAfter(now), triggersPosted, usedPhrases });
  } catch {
    // Best effort — the log's once-a-day guard still stops a same-key repost.
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
