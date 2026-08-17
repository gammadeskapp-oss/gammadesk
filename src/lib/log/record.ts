import 'server-only';

import { getPositioning } from '../positioning';
import { marketNow } from '../time';
import { fetchDailyBar } from './settlement';
import { readLog, updateLog } from './store';
import { judge, type LogEntry } from './types';

export interface SnapshotResult {
  status: 'recorded' | 'already-recorded' | 'skipped';
  date: string;
  reason?: string;
  entry?: LogEntry;
}

/**
 * Record today's levels.
 *
 * Deliberately refuses to record when the market is shut or the upstream feed
 * has not caught up to today, because a snapshot taken against yesterday's
 * chain would silently pollute the accuracy record — the one thing this page
 * exists to keep honest.
 */
export async function recordSnapshot(
  options: { force?: boolean } = {},
): Promise<SnapshotResult> {
  const now = marketNow();
  const { date, weekday, hour } = now;

  if (!options.force) {
    if (weekday === 0 || weekday === 6) {
      return { status: 'skipped', date, reason: 'Weekend — market closed.' };
    }
    // Before the 09:30 open there is nothing meaningful to snapshot.
    if (hour < 9 || (hour === 9 && now.minute < 30)) {
      return { status: 'skipped', date, reason: 'Before the market open.' };
    }
  }

  const existing = await readLog();
  if (existing.some((e) => e.date === date)) {
    return { status: 'already-recorded', date };
  }

  // Throws when the upstream is unreachable, which is the intended outcome:
  // a missing entry is recoverable, a fabricated one is not.
  const data = await getPositioning();

  // Guard against a market holiday, when the feed still responds but carries
  // the previous session.
  if (!options.force) {
    const quoteDay = new Date(data.meta.quoteDateIso);
    const quoteDate = marketNow(quoteDay).date;
    if (quoteDate !== date) {
      return {
        status: 'skipped',
        date,
        reason: `Feed is still on ${quoteDate}; likely a market holiday.`,
      };
    }
  }

  const entry: LogEntry = {
    date,
    snapshotAt: new Date().toISOString(),
    regime: data.summary.regime,
    flipLevel: data.summary.flipLevel,
    spotAtSnapshot: data.spot,
    magnetAbove: data.summary.magnetAbove?.strike ?? null,
    magnetBelow: data.summary.magnetBelow?.strike ?? null,
    netGex: data.summary.netGex,
    settled: false,
  };

  await updateLog((entries) =>
    entries.some((e) => e.date === date) ? entries : [...entries, entry],
  );

  return { status: 'recorded', date, entry };
}

export interface SettleResult {
  settled: string[];
  stillPending: string[];
  checked: number;
}

/**
 * Settle every unsettled day whose session has finished.
 *
 * Runs over the whole backlog rather than just yesterday, so a cron run that
 * was missed or delayed self-heals on the next pass — Polygon's daily bars are
 * historical, so an old day can still be filled in.
 */
export async function settleOutstanding(): Promise<SettleResult> {
  const now = marketNow();
  const entries = await readLog();

  const closed = (date: string) => {
    if (date < now.date) return true;
    // Today only counts once the 16:00 close has passed.
    return date === now.date && now.hour >= 16;
  };

  const pending = entries.filter((e) => !e.settled && closed(e.date));

  const settled: string[] = [];
  const stillPending: string[] = [];
  const bars = new Map<string, Awaited<ReturnType<typeof fetchDailyBar>>>();

  for (const entry of pending) {
    const bar = await fetchDailyBar(entry.date);
    bars.set(entry.date, bar);
    if (bar) settled.push(entry.date);
    else stillPending.push(entry.date);
  }

  if (settled.length > 0) {
    await updateLog((current) =>
      current.map((entry) => {
        const bar = bars.get(entry.date);
        if (entry.settled || !bar) return entry;

        const { flipOutcome, magnetTouched } = judge(entry, bar);
        return {
          ...entry,
          settled: true,
          settledAt: new Date().toISOString(),
          settledFrom: bar.from,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          flipOutcome,
          magnetTouched,
        };
      }),
    );
  }

  return { settled, stillPending, checked: pending.length };
}
