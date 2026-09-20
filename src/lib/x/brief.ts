import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { Brief, ClosingBrief, WeeklyBrief } from './text';

/**
 * Durable storage for the daily Cowork briefs — the morning "Desk" brief and
 * the "Closing Bell" brief — kept as separate documents so a morning update
 * never clobbers a closing one. Both live in Vercel Blob so they survive
 * redeploys between the posting tasks' runs.
 */

const morningStore = createJsonStore<Brief | null>(
  'gammadesk/x-brief.json',
  () => null,
  (raw) => (raw && typeof raw === 'object' && typeof (raw as Brief).date === 'string' ? (raw as Brief) : null),
);

const closingStore = createJsonStore<ClosingBrief | null>(
  'gammadesk/x-brief-closing.json',
  () => null,
  (raw) => (raw && typeof raw === 'object' && typeof (raw as ClosingBrief).date === 'string' ? (raw as ClosingBrief) : null),
);

const weeklyStore = createJsonStore<WeeklyBrief | null>(
  'gammadesk/x-brief-weekly.json',
  () => null,
  (raw) => (raw && typeof raw === 'object' && typeof (raw as WeeklyBrief).weekEnding === 'string' ? (raw as WeeklyBrief) : null),
);

// --- morning -----------------------------------------------------------------

export async function saveBrief(brief: Brief): Promise<void> {
  await morningStore.write(brief);
}

export async function readBrief(): Promise<Brief | null> {
  return morningStore.read().catch(() => null);
}

/** The stored morning brief only if it is for `date`; otherwise null. */
export async function readBriefForDate(date: string): Promise<Brief | null> {
  const brief = await readBrief();
  return brief && brief.date === date ? brief : null;
}

// --- closing -----------------------------------------------------------------

export async function saveClosingBrief(brief: ClosingBrief): Promise<void> {
  await closingStore.write(brief);
}

export async function readClosingBrief(): Promise<ClosingBrief | null> {
  return closingStore.read().catch(() => null);
}

/** The stored closing brief only if it is for `date`; otherwise null. */
export async function readClosingBriefForDate(date: string): Promise<ClosingBrief | null> {
  const brief = await readClosingBrief();
  return brief && brief.date === date ? brief : null;
}

// --- weekly ------------------------------------------------------------------

export async function saveWeeklyBrief(brief: WeeklyBrief): Promise<void> {
  await weeklyStore.write(brief);
}

export async function readWeeklyBrief(): Promise<WeeklyBrief | null> {
  return weeklyStore.read().catch(() => null);
}

/** The stored weekly brief only if it is for `weekEnding`; otherwise null. */
export async function readWeeklyBriefForWeek(weekEnding: string): Promise<WeeklyBrief | null> {
  const brief = await readWeeklyBrief();
  return brief && brief.weekEnding === weekEnding ? brief : null;
}
