import 'server-only';

import { tradierToken } from '../breadth/tradier';
import { daysBetween } from './earningsRules';
import type { EarningsInfo } from './types';

/**
 * Next earnings date per symbol, for the scanner's exclusion rule.
 *
 * ## Where this comes from, and what was checked first
 *
 * The repo already keeps a calendar at `lib/events/calendar.json`, read by the
 * staleness guard and the home page's event row. It is **macro only** — FOMC,
 * CPI, PPI, the jobs report, and the market holiday list. There is no
 * per-company earnings data in it and nothing else in the tree carries any, so
 * it cannot answer this question and is not consulted here.
 *
 * The fallback is Tradier's fundamentals calendar, on the `TRADIER_TOKEN` the
 * breadth sweep already uses. No new credential, no new vendor.
 *
 * ## It is a beta endpoint and it is often not there
 *
 * `/beta/markets/fundamentals/calendars` is gated behind a market-data
 * entitlement. On a token without one it answers 401, 403 or 404 rather than
 * an empty list, and that is the *expected* path here rather than an
 * exceptional one.
 *
 * Which is why every failure mode in this file lands on the same result:
 * `state: 'unknown'`, with the reason recorded. Never `daysAway: 999`, never a
 * silent `known` with a far-off date. See `EarningsInfo` — an unknown date is
 * not a safe date, and the caller is required to say so out loud rather than
 * treat the name as clear.
 */

const CALENDARS_URL = 'https://api.tradier.com/beta/markets/fundamentals/calendars';

/** Symbols per request. The endpoint takes a comma-separated list. */
const BATCH = 50;

/** Long enough for a cold upstream, short enough not to hold up the scan. */
const TIMEOUT_MS = 8000;

/**
 * Tradier's fundamentals payload is loosely typed and inconsistently shaped —
 * the same field arrives as an object or a single-element array depending on
 * the symbol. Everything below narrows defensively rather than casting.
 */
interface RawEvent {
  begin_date_time?: string;
  end_date_time?: string;
  event_type?: number | string;
  event?: string;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** `YYYY-MM-DD` out of whatever date-like string the payload carried. */
function isoDay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  return match ? match[0].slice(0, 10) : null;
}


/**
 * The next earnings date at or after `fromIso`, out of a symbol's event list.
 *
 * Past reports are skipped rather than being allowed to produce a negative
 * `daysAway` that then reads as "not soon". `event_type` 8 is Tradier's
 * earnings code; the text match is a belt-and-braces fallback for the rows
 * that carry a description and no code.
 */
function nextEarnings(events: RawEvent[], fromIso: string): string | null {
  const dates = events
    .filter((e) => {
      const type = String(e.event_type ?? '');
      const text = String(e.event ?? '').toLowerCase();
      return type === '8' || text.includes('earnings') || text.includes('report');
    })
    .map((e) => isoDay(e.begin_date_time ?? e.end_date_time))
    .filter((d): d is string => d !== null)
    .filter((d) => daysBetween(fromIso, d) >= 0)
    .sort();

  return dates[0] ?? null;
}

function unknown(reason: string): EarningsInfo {
  return { state: 'unknown', dateIso: null, daysAway: null, source: reason };
}

export interface EarningsLookup {
  /** Symbol to reading. Every requested symbol is present. */
  bySymbol: Map<string, EarningsInfo>;
  /** One line for the UI saying where these came from. */
  source: string;
}

/**
 * Look up the next earnings date for each symbol.
 *
 * Never throws and never rejects: an outage here must degrade the scan to
 * "earnings unknown", not take it down. Every symbol asked for comes back in
 * the map, so a caller cannot accidentally treat an absent key as "no
 * earnings".
 */
export async function lookupEarnings(
  symbols: string[],
  fromIso: string,
): Promise<EarningsLookup> {
  const bySymbol = new Map<string, EarningsInfo>();

  const token = tradierToken();
  if (!token) {
    const reason = 'no TRADIER_TOKEN, so no earnings dates were fetched';
    for (const symbol of symbols) bySymbol.set(symbol, unknown(reason));
    return { bySymbol, source: reason };
  }

  let reached = 0;
  let failure: string | null = null;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);

    let payload: unknown;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(
          `${CALENDARS_URL}?symbols=${encodeURIComponent(batch.join(','))}`,
          {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: controller.signal,
            cache: 'no-store',
          },
        );
        if (!response.ok) {
          // 401/403/404 here is the ordinary case on a token without the
          // fundamentals entitlement, not an incident. It is recorded and the
          // batch falls through to unknown.
          failure ??= `Tradier fundamentals returned HTTP ${response.status}`;
          for (const symbol of batch) {
            bySymbol.set(symbol, unknown(`Tradier fundamentals HTTP ${response.status}`));
          }
          continue;
        }
        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'Tradier fundamentals timed out'
          : `Tradier fundamentals unreachable: ${
              error instanceof Error ? error.message : String(error)
            }`;
      failure ??= reason;
      for (const symbol of batch) bySymbol.set(symbol, unknown(reason));
      continue;
    }

    /*
     * The response is an array of per-symbol envelopes, each carrying a
     * `results` list in which the corporate-calendar entry is one of several
     * result types. Anything that does not narrow cleanly is left unknown for
     * that symbol rather than guessed at.
     */
    const entries = asArray(payload as unknown[]);
    const seen = new Set<string>();

    for (const entry of entries) {
      const env = entry as { request?: string; results?: unknown };
      const symbol = String(env.request ?? '').toUpperCase();
      if (!symbol || !batch.includes(symbol)) continue;

      const events: RawEvent[] = [];
      for (const result of asArray(env.results as unknown[])) {
        const tables = (result as { tables?: { corporate_calendars?: unknown } })
          .tables;
        for (const row of asArray(tables?.corporate_calendars as RawEvent[])) {
          events.push(row);
        }
      }

      const dateIso = nextEarnings(events, fromIso);
      seen.add(symbol);

      if (dateIso === null) {
        /*
         * The lookup worked and returned no upcoming report. That is still
         * recorded as `unknown`, not as "no earnings soon": an empty corporate
         * calendar most often means the endpoint has no coverage for this
         * name, and the two are indistinguishable from here. Claiming the
         * stronger of the two readings is precisely the mistake this module
         * exists to avoid.
         */
        bySymbol.set(symbol, unknown('no upcoming report listed, and no coverage confirmed'));
        continue;
      }

      bySymbol.set(symbol, {
        state: 'known',
        dateIso,
        daysAway: daysBetween(fromIso, dateIso),
        source: 'Tradier fundamentals calendar',
      });
      reached += 1;
    }

    for (const symbol of batch) {
      if (!seen.has(symbol) && !bySymbol.has(symbol)) {
        bySymbol.set(symbol, unknown('not present in the fundamentals response'));
      }
    }
  }

  // Belt and braces: nothing may be missing from the map.
  for (const symbol of symbols) {
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, unknown('not looked up'));
  }

  const source =
    reached > 0
      ? `Tradier fundamentals calendar — ${reached} of ${symbols.length} names dated${
          failure ? `; ${failure} for the rest` : ''
        }`
      : (failure ??
        'No earnings dates were available. The macro calendar in lib/events carries no per-company dates, and Tradier fundamentals returned none.');

  return { bySymbol, source };
}
