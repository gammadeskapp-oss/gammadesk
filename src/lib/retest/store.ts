import 'server-only';

import { createJsonStore } from '../jsonStore';
import { marketToday } from '../time';
import type { LevelState, RetestEvent } from './types';

export { storeStatus } from '../jsonStore';

/**
 * The event feed and the level states, in Vercel Blob beside the Accuracy Log.
 *
 * ## Why state is persisted rather than recomputed
 *
 * It would be simpler to replay the whole session's bars on every refresh and
 * derive the events from scratch. It would also be wrong. Levels move: the
 * gamma flip is re-solved every time the option chain updates, so replaying
 * this morning's bars against this afternoon's flip level would quietly
 * rewrite what the feed said had happened. An event fired at 09:52 against 770
 * has to keep saying 770 even once the level sits at 771.
 *
 * So each level's state carries forward, each refresh folds in only the bars
 * it has not seen, and every event is stamped with the level value that was
 * current when it fired.
 *
 * One document per session, replaced when the New York date changes. Yesterday
 * evening's break is not commentary on this morning's chart.
 */

const SCHEMA = 1;

export interface RetestDoc {
  schema: number;
  /** New York session date, `YYYY-MM-DD`. */
  date: string;
  /** Symbol these levels and events belong to. */
  symbol: string;
  /** Newest first, which is the order the feed renders in. */
  events: RetestEvent[];
  /** Keyed by level id. */
  states: Record<string, LevelState>;
  updatedAt: string;
}

/**
 * Events kept for one session.
 *
 * The cooldown caps each level at four an hour, and there are about ten levels
 * — so a busy session is well inside this. The cap is a backstop against an
 * unbounded document, not an editorial decision about what is worth keeping.
 */
export const MAX_EVENTS = 200;

function empty(symbol: string, now: Date): RetestDoc {
  return {
    schema: SCHEMA,
    date: marketToday(now),
    symbol,
    events: [],
    states: {},
    updatedAt: now.toISOString(),
  };
}

const store = createJsonStore<RetestDoc | null>(
  'gammadesk/retests.json',
  () => null,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as RetestDoc;
    if (doc.schema !== SCHEMA || typeof doc.date !== 'string') return null;
    if (!Array.isArray(doc.events) || typeof doc.states !== 'object') return null;
    return doc;
  },
);

/**
 * Today's document for this symbol, or an empty one.
 *
 * A stored document for a different symbol is discarded rather than merged.
 * The detector follows whichever ticker the page is showing, and one feed
 * holding two symbols' levels would print event lines whose prices belong to
 * something else entirely.
 */
export async function readRetestDoc(
  symbol: string,
  now: Date = new Date(),
): Promise<RetestDoc> {
  const doc = await store.read();
  if (!doc || doc.date !== marketToday(now) || doc.symbol !== symbol) {
    return empty(symbol, now);
  }
  return doc;
}

export async function writeRetestDoc(doc: RetestDoc): Promise<void> {
  await store.write({ ...doc, events: doc.events.slice(0, MAX_EVENTS) });
}
