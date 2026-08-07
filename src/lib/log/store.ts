import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { LogEntry } from './types';

export { storeStatus } from '../jsonStore';
export type { StoreStatus, StoreKind } from '../jsonStore';

function sortNewestFirst(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

const store = createJsonStore<LogEntry[]>(
  'gammadesk/accuracy-log.json',
  () => [],
  (raw) => {
    if (Array.isArray(raw)) return raw as LogEntry[];
    // Earlier versions wrapped the array in `{ entries: [...] }`; still read it.
    if (raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)) {
      return (raw as { entries: LogEntry[] }).entries;
    }
    return null;
  },
);

export async function readLog(): Promise<LogEntry[]> {
  return sortNewestFirst(await store.read());
}

export async function writeLog(entries: LogEntry[]): Promise<void> {
  await store.write(sortNewestFirst(entries));
}

/** Read, transform, write. */
export async function updateLog(
  mutate: (entries: LogEntry[]) => LogEntry[] | Promise<LogEntry[]>,
): Promise<LogEntry[]> {
  return store.update(async (current) =>
    sortNewestFirst(await mutate(sortNewestFirst(current))),
  );
}
