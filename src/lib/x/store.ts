import 'server-only';

import { createJsonStore, storeStatus } from '../jsonStore';
import type { PauseState, PostLogEntry, PostSlotKind } from './types';

/**
 * Durable state for the X poster: the post log and the pause switch.
 *
 * Both live in Vercel Blob in production (see `jsonStore.ts`) so they survive a
 * redeploy — a poster that forgot what it sent this morning would double-post
 * every time a deploy landed mid-session.
 */

export { storeStatus };

/** Kept longer than the digest/post logs — this is the audit trail. */
const KEEP = 400;

const logStore = createJsonStore<PostLogEntry[]>(
  'gammadesk/x-posts.json',
  () => [],
  (raw) => (Array.isArray(raw) ? (raw as PostLogEntry[]) : null),
);

const pauseStore = createJsonStore<PauseState>(
  'gammadesk/x-pause.json',
  () => ({ paused: false }),
  (raw) => {
    if (raw && typeof raw === 'object' && typeof (raw as PauseState).paused === 'boolean') {
      return raw as PauseState;
    }
    return null;
  },
);

function newestFirst(entries: PostLogEntry[]): PostLogEntry[] {
  return [...entries].sort((a, b) => b.at.localeCompare(a.at));
}

export async function readLog(): Promise<PostLogEntry[]> {
  return newestFirst(await logStore.read().catch(() => []));
}

/** Append one entry, trimming to the last `KEEP`. Never throws. */
export async function appendLog(entry: PostLogEntry): Promise<void> {
  try {
    await logStore.update((current) => newestFirst([entry, ...current]).slice(0, KEEP));
  } catch {
    // A log write failing must not itself cause a double-post or crash a cron.
    // The "already posted" check below reads the same store, so a lost write
    // could in principle re-post — accepted as strictly better than throwing
    // inside the poster, and vanishingly rare (writers run minutes apart).
  }
}

/**
 * Has this exact slot already been sent for this trading date?
 *
 * Counts only `sent` rows: a skipped or failed attempt should be retried on the
 * next firing, not treated as done. This is the guard that makes every slot
 * post at most once a day.
 */
export async function alreadyPosted(slotKey: string, date: string): Promise<boolean> {
  const log = await readLog().catch(() => []);
  return log.some((e) => e.slotKey === slotKey && e.date === date && e.outcome === 'sent');
}

/** The most recent `sent` entry for a slot kind, for the sanity jump check. */
export async function lastSentForSlot(slot: PostSlotKind): Promise<PostLogEntry | null> {
  const log = await readLog().catch(() => []);
  return log.find((e) => e.slot === slot && e.outcome === 'sent') ?? null;
}

export async function readPause(): Promise<PauseState> {
  return pauseStore.read().catch(() => ({ paused: false }));
}

/** True when posting is paused by the runtime switch (not the env kill switch). */
export async function isPaused(): Promise<boolean> {
  return (await readPause()).paused;
}

export async function setPause(state: PauseState): Promise<PauseState> {
  await pauseStore.write(state);
  return state;
}

/**
 * "Pause today": an owner pause scoped to one market date that the autonomous
 * tick auto-resumes on the next trading day (see `shouldAutoResume`).
 */
export async function pauseToday(date: string): Promise<PauseState> {
  return setPause({
    paused: true,
    by: 'owner',
    scope: 'today',
    date,
    reason: 'Paused for today from the admin page (auto-resumes next trading day).',
    at: new Date().toISOString(),
  });
}

/** Clear the pause, recording why (an owner click, or an automatic resume). */
export async function resume(reason: string): Promise<PauseState> {
  return setPause({ paused: false, by: 'owner', reason, at: new Date().toISOString() });
}

/**
 * Auto-pause after an auth or billing failure. Never overwrites an existing
 * owner pause with an auto one, so a human's note is not clobbered by a
 * subsequent API error.
 */
export async function autoPause(reason: string): Promise<void> {
  try {
    const current = await readPause();
    if (current.paused && current.by === 'owner') return;
    await setPause({ paused: true, by: 'auto', reason, at: new Date().toISOString() });
  } catch {
    // Best effort — the failure is already being logged by the caller.
  }
}
