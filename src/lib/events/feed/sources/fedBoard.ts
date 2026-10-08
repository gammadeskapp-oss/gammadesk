import 'server-only';

import { eventsWithin } from '../merge';
import { fetchText, errorMessage } from '../http';
import type { SourceResult } from '../store';
import { parseFedBoardCalendar } from './fedBoardParse';

/**
 * Fetch the Fed Board calendar for the window and parse it.
 *
 * The calendar is published a month per page, so a seven-day window that
 * straddles a month boundary pulls both pages and concatenates the parse. A
 * single page failing fails the whole source for this run — a partial calendar
 * would quietly hide half a week of events — and the store keeps the last good
 * fetch (see `../store.ts`).
 */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthUrl(year: number, monthIndex0: number): string {
  return `https://www.federalreserve.gov/newsevents/${year}-${MONTHS[monthIndex0]}.htm`;
}

/** The distinct {year, month} pages a `YYYY-MM-DD` range touches. */
function monthsInRange(fromDate: string, toDate: string): Array<{ year: number; month: number }> {
  const [fy, fm] = fromDate.split('-').map(Number);
  const [ty, tm] = toDate.split('-').map(Number);
  const out: Array<{ year: number; month: number }> = [];
  let y = fy;
  let m = fm; // 1-based
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ year: y, month: m - 1 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export async function fetchFedBoard(range: { from: string; to: string }): Promise<SourceResult> {
  try {
    const pages = monthsInRange(range.from, range.to);
    const all = [];
    for (const { year, month } of pages) {
      const url = monthUrl(year, month);
      const html = await fetchText(url);
      all.push(...parseFedBoardCalendar(html, { sourceUrl: url }));
    }
    return { ok: true, events: eventsWithin(all, range.from, range.to) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
