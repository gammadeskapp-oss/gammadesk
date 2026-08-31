import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { readLog } from '../log/store';
import type { LogEntry } from '../log/types';
import { fetchBars } from '../ticker/bars';
import { buildHistory, type HistoryView } from './build';

export type { HistoryDay, HistoryView, LevelStats } from './build';

/**
 * The last thirty sessions, with each day's recorded levels attached.
 *
 * ## Nothing new is collected here
 *
 * The accuracy log has recorded the flip level, the spot at snapshot and both
 * magnet strikes every weekday morning since it was added, and settles each
 * day's high, low and close after the close. That is the history — a separate
 * daily cron writing the same numbers to a second store would have created two
 * records that could disagree, and the one that disagreed would be whichever
 * nobody was reading.
 *
 * What the log did not carry, until 2026-08-31, is the *displayed* level: the
 * nearest strong wall rather than the biggest magnet. That is now recorded
 * alongside, so entries from here on carry both. Older entries have only the
 * magnets, and the chart says so rather than drawing one definition as if it
 * were the other.
 */

/** Sessions plotted. */
export const WINDOW = 30;

export function getHistory(): Promise<HistoryView> {
  return cached('history:levels', 900, async () => {
    const entries: LogEntry[] = await readLog().catch(() => []);

    /*
     * Yahoo, not Polygon. This is one symbol so the quota argument does not
     * bite either way, but the log's own settlement already prefers the free
     * path and matching it means the candles and the settled highs and lows
     * come from the same place — two sources would put a level mark against a
     * bar that disagrees with the outcome recorded beside it.
     */
    const series = await fetchBars(config.symbol, {
      prefer: 'yahoo',
      withName: false,
      years: 1,
    }).catch(() => null);

    return buildHistory({
      entries,
      bars: series?.bars ?? [],
      symbol: config.symbol,
      window: WINDOW,
      barsSource: series?.source ?? null,
    });
  });
}
