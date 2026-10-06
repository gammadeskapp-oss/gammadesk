import 'server-only';

import { cached } from '../cache';
import { fetchBars } from '../ticker/bars';
import { buildSpyRspReading, MONTH_LOOKBACK_SESSIONS, type SpyRspReading } from './spyRspCore';
import { fetchSparks } from './spark';

/**
 * SPY vs RSP — the fetch and the session cache.
 *
 * The verdict, wording and staleness rule are pure and live in `spyRspCore.ts`
 * (re-exported below); this file is the IO half, kept `server-only` like
 * `spread.ts` and `index.ts`.
 *
 * ## One calculation, read everywhere
 *
 * This is the single source for the SPY-vs-RSP reading. The dashboard, the
 * decision page, the scanner header, the daily page, the X posts and the poster
 * image all render the same stored `SpyRspReading` — none of them computes it.
 * It is refreshed once per breadth cron tick and stored in the breadth document
 * (see `store.ts`); pages and the poster read the stored value only.
 *
 * ## Source
 *
 * Yahoo, the same feed the equal-weight cross-check already uses — today's two
 * changes from a spark, the month from daily bars. The configured Polygon plan
 * is options-only and its stocks endpoints 403 (see `polygon.ts`), so it cannot
 * price RSP; Yahoo is the shared fresh source for both legs here. Every reading
 * carries the real timestamp it was taken at, and a stale one is hidden rather
 * than shown (see `isSpyRspStale`) — the number is never faked.
 */

export * from './spyRspCore';

function dayChangePct(closes: number[], previousClose: number): number {
  const last = closes[closes.length - 1];
  return ((last - previousClose) / previousClose) * 100;
}

/**
 * The RSP/SPY ratio change over ~a month, from daily bars.
 *
 * Cached for an hour: the month ratio barely moves within a session and the
 * daily bars behind it only change once a day, so there is no reason to re-pull
 * two 1-year bar series on every minute's breadth refresh.
 *
 * @returns the percent change in the ratio and a short ratio series for the
 * tiny line, or nulls when either symbol's bars could not be read.
 */
function fetchMonthRatio(): Promise<{ changePct: number | null; series: number[] | null }> {
  return cached('spyRsp:monthRatio', 3600, async () => {
    const [rsp, spy] = await Promise.all([
      fetchBars('RSP', { prefer: 'yahoo', withName: false, years: 1 }).catch(() => null),
      fetchBars('SPY', { prefer: 'yahoo', withName: false, years: 1 }).catch(() => null),
    ]);

    if (!rsp || !spy || rsp.bars.length === 0 || spy.bars.length === 0) {
      return { changePct: null, series: null };
    }

    // Align on shared dates, oldest first, so a ratio is always same-day/same-day.
    const spyByDate = new Map(spy.bars.map((b) => [b.date, b.close]));
    const ratios: number[] = [];
    for (const bar of rsp.bars) {
      const spyClose = spyByDate.get(bar.date);
      if (typeof spyClose === 'number' && spyClose > 0) ratios.push(bar.close / spyClose);
    }

    if (ratios.length <= MONTH_LOOKBACK_SESSIONS) return { changePct: null, series: null };

    const now = ratios[ratios.length - 1];
    const then = ratios[ratios.length - 1 - MONTH_LOOKBACK_SESSIONS];
    const changePct = ((now - then) / then) * 100;

    // A month of ratio points for the sparkline — the tail is enough.
    const series = ratios.slice(-(MONTH_LOOKBACK_SESSIONS + 1));
    return { changePct, series };
  });
}

/**
 * Fetch and build the current reading, or null when today's two changes cannot
 * be read (a spread computed from one leg is not a spread). The month ratio is
 * allowed to be null without hiding the whole reading — the day's verdict is the
 * headline, the month is context.
 */
export async function fetchSpyRsp(): Promise<SpyRspReading | null> {
  const [{ series }, month] = await Promise.all([
    fetchSparks(['RSP', 'SPY'], { timeoutMs: 10_000 }),
    fetchMonthRatio().catch(() => ({ changePct: null, series: null })),
  ]);

  const rsp = series.get('RSP');
  const spy = series.get('SPY');
  if (!rsp || !spy) return null;

  return buildSpyRspReading({
    spyPct: dayChangePct(spy.closes, spy.previousClose),
    rspPct: dayChangePct(rsp.closes, rsp.previousClose),
    monthRatioChangePct: month.changePct,
    monthRatioSeries: month.series,
    at: new Date().toISOString(),
  });
}
