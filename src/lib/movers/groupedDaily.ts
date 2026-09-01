import 'server-only';

import { config } from '../config';
import { operatorDetail } from '../errorText';

/**
 * Whole-market daily bars for one completed session, in a single request.
 *
 * ## Why this endpoint and not a quote feed
 *
 * This list needs one number per name that this project does not already
 * store: the share volume actually traded in the session being reported. The
 * RS digest holds the twenty-session average — the denominator — but no
 * single-session figure, and adding one to `DigestEntry` would mean a schema
 * field that stays empty until every shard has rotated, which is exactly the
 * gap the `ema20` fields spent a night in.
 *
 * `/v2/aggs/grouped` answers it for the entire US market in one call: roughly
 * twelve and a half thousand tickers with open, close and volume, of which
 * this reads the five hundred it already tracks. One request, whatever the
 * universe size.
 *
 * ## Entitlement, checked rather than assumed
 *
 * Measured against the live API on 2026-09-01 on the key in `.env.local`:
 * grouped bars for a **completed prior** session return HTTP 200 with 12,593
 * results, while the same call for the current day returns 403
 * `NOT_AUTHORIZED`, as does `/v2/snapshot/.../tickers`. So this plan carries
 * finished sessions and not today's.
 *
 * That is the whole reason this page reports a completed session rather than a
 * live one. It is not a limitation being worked around quietly — the page says
 * which session it is showing, and `sessionDate` is what it says it is.
 *
 * See `polygon.ts` for the same entitlement story on the options side.
 */

const GROUPED_URL = 'https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks';

/** Long enough for a twelve-thousand-row payload, short enough to fail a page fast. */
const TIMEOUT_MS = 20_000;

/** One session's traded volume and closing price for a single ticker. */
export interface SessionBar {
  /** Shares traded in the session. */
  volume: number;
  /** Closing price of the session. */
  close: number;
}

export type GroupedOutcome =
  | { ok: true; bars: Map<string, SessionBar> }
  | { ok: false; reason: string };

interface RawBar {
  T?: string;
  v?: number;
  c?: number;
}

/**
 * Polygon spells class shares with a dot, the same way this project does —
 * `BRK.B` comes back as `BRK.B`. Unlike the Tradier quote path there is
 * nothing to translate here, which is worth stating so nobody adds a
 * translation to match the other adapter and breaks two working symbols.
 */
export async function fetchGroupedDaily(sessionDate: string): Promise<GroupedOutcome> {
  const key = config.apiKey;
  if (!key) {
    return {
      ok: false,
      reason:
        'POLYGON_API_KEY is not set, so the session’s share volumes could not be read.',
    };
  }

  const url = new URL(`${GROUPED_URL}/${sessionDate}`);
  url.searchParams.set('adjusted', 'true');
  url.searchParams.set('apiKey', key);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    console.warn('[movers] grouped daily request failed:', operatorDetail(error));
    return { ok: false, reason: 'The market-data request did not complete.' };
  }

  if (response.status === 403) {
    /*
     * Named separately because it is the one failure that is about the plan
     * rather than the day: it is what asking for a session this key is not
     * entitled to looks like, and it will not fix itself on a retry.
     */
    console.warn(`[movers] grouped daily refused for ${sessionDate}: HTTP 403`);
    return {
      ok: false,
      reason: `Market data for ${sessionDate} is not available on the current data plan.`,
    };
  }

  if (!response.ok) {
    console.warn(`[movers] grouped daily returned HTTP ${response.status} for ${sessionDate}`);
    return { ok: false, reason: 'The market-data provider did not answer.' };
  }

  let payload: { results?: RawBar[]; resultsCount?: number };
  try {
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    console.warn('[movers] grouped daily payload unreadable:', operatorDetail(error));
    return { ok: false, reason: 'The market-data response could not be read.' };
  }

  const results = payload.results ?? [];
  if (results.length === 0) {
    /*
     * A 200 with nothing in it is what a non-trading day returns — a weekend,
     * or a holiday the session calendar and the exchange disagree about. It is
     * reported as its own case rather than as an outage, because retrying will
     * not help and the reader should be told the day was closed.
     */
    return {
      ok: false,
      reason: `No market data was published for ${sessionDate}; it was not a trading day.`,
    };
  }

  const bars = new Map<string, SessionBar>();
  for (const row of results) {
    const symbol = row.T;
    const volume = row.v;
    const close = row.c;
    // A row missing any of the three cannot be graded and is not invented into
    // one. Volume of exactly zero is dropped too: a name that did not trade has
    // no relative volume, and zero would compute one and read as "quiet".
    if (typeof symbol !== 'string' || symbol.length === 0) continue;
    if (typeof volume !== 'number' || !Number.isFinite(volume) || !(volume > 0)) continue;
    if (typeof close !== 'number' || !Number.isFinite(close) || !(close > 0)) continue;
    bars.set(symbol, { volume, close });
  }

  return { ok: true, bars };
}
