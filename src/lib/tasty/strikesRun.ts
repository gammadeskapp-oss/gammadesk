import 'server-only';

import { tastySourceMode } from './mode';
import {
  inWindow,
  OI_FIELD,
  sideMatches,
  topStrikes,
  VOLUME_FIELD,
  type ContractReading,
  type StrikesRow,
  type StrikesSide,
} from './strikes';

/**
 * The live run behind `/lab`'s Strikes tab. Server-only.
 *
 * ## Where it may run
 *
 * Local or preview only, on the live feed only. A production deploy has no
 * Strikes tab and its route answers 404: the dxFeed data comes under a
 * personal-use licence, and a page on the public host — password or not — is
 * a URL that serves it. Off the live feed (`TASTY_SOURCE` unset or `mock`) the
 * tab says so and refuses to run; there is no mock version of this table.
 *
 * ## Fresh on every run
 *
 * No cache anywhere on this path. Each ticker's chain is fetched from
 * Tastytrade again, and `refresh` on the dxLink client drops whatever Summary
 * and Trade events it held for those contracts and re-subscribes, so every
 * number in a row arrived after the run asked for it. A run at 08:00 and
 * another at noon read the feed twice. Subscriptions the run added are
 * released when its ticker finishes, so a hundred tickers never pile up on the
 * socket.
 *
 * ## Bounded
 *
 * Tickers run `CONCURRENCY` at a time, each with its own timeout scaled to the
 * size of its contract set. A ticker that times out reports what arrived and
 * says how much was missing; a ticker that throws becomes an error row. Neither
 * stops the run.
 */

const CONCURRENCY = 4;
const READY_TIMEOUT_MS = 12_000;
/** Base wait for one ticker's events, plus a little per thousand contracts. */
const TICKER_BASE_MS = 6_000;
const TICKER_PER_1000_MS = 1_500;
const TICKER_MAX_MS = 20_000;
/** After every Summary is in, how much longer to give Trade events. */
const VOLUME_GRACE_MS = 1_500;
/** Share of contracts that counts as "everything arrived". */
const FILL = 0.98;

export type StrikesAvailability = { ok: true } | { ok: false; reason: string; hidden: boolean };

/** Whether the Strikes tab exists here, and whether it can run. */
export function strikesAvailability(): StrikesAvailability {
  const key = 'VERCEL_ENV';
  if (process.env[key] === 'production') {
    return { ok: false, hidden: true, reason: 'The Strikes tab is local-only and never runs on the production deploy.' };
  }
  if (tastySourceMode() !== 'live') {
    return {
      ok: false,
      hidden: false,
      reason: 'The Strikes tab reads the live dxFeed only. Set TASTY_SOURCE=live (with the Tastytrade credentials) in .env.local and restart the dev server.',
    };
  }
  return { ok: true };
}

export interface StrikesRunOptions {
  windowDays: number;
  side: StrikesSide;
  signal?: AbortSignal;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Run every ticker, calling `onRow` as each one finishes (in completion order). */
export async function runStrikes(
  tickers: readonly string[],
  options: StrikesRunOptions,
  onRow: (row: StrikesRow) => void,
): Promise<void> {
  const { dxFeed, waitFor } = await import('./dxlink');
  const feed = dxFeed();

  const ready = await waitFor(() => feed.isReady || Boolean(options.signal?.aborted), READY_TIMEOUT_MS);
  if (!ready || !feed.isReady) {
    const reason = `dxLink did not connect: ${feed.lastError ?? 'no reply within 12 s'}`;
    for (const stock of tickers) onRow(errorRow(stock, reason, 0));
    return;
  }

  let next = 0;
  const worker = async () => {
    while (next < tickers.length && !options.signal?.aborted) {
      const stock = tickers[next++];
      const started = Date.now();
      try {
        onRow(await runOne(stock, options, started));
      } catch (error) {
        onRow(errorRow(stock, error instanceof Error ? error.message : String(error), Date.now() - started));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tickers.length) }, worker));
}

function errorRow(stock: string, note: string, ms: number): StrikesRow {
  return {
    stock,
    status: 'error',
    topOiStrike: null,
    topOi: null,
    topVolumeStrike: null,
    topVolume: null,
    contracts: 0,
    oiReported: 0,
    volumeReported: 0,
    note,
    ms,
  };
}

async function runOne(stock: string, options: StrikesRunOptions, started: number): Promise<StrikesRow> {
  const { dxFeed, fetchChain, waitFor } = await import('./dxlink');
  const feed = dxFeed();
  const now = new Date();

  const refs = (await fetchChain(stock, now)).filter(
    (r) => inWindow(r.expiration, options.windowDays, now) && sideMatches(r.type, options.side),
  );
  if (refs.length === 0) {
    return errorRow(stock, `No ${options.side === 'all' ? '' : `${options.side.slice(0, -1)} `}contracts expire within ${options.windowDays} days.`, Date.now() - started);
  }

  const items = refs.flatMap((r) => [
    { type: 'Summary' as const, symbol: r.streamerSymbol },
    { type: 'Trade' as const, symbol: r.streamerSymbol },
  ]);
  const added = feed.refresh(items);
  try {
    const timeout = Math.min(TICKER_MAX_MS, TICKER_BASE_MS + (refs.length / 1000) * TICKER_PER_1000_MS);
    const count = (field: 'summary' | 'trade') => refs.filter((r) => feed.states.get(r.streamerSymbol)?.[field]).length;
    const want = Math.ceil(refs.length * FILL);

    const deadline = started + timeout;
    await waitFor(() => count('summary') >= want || Boolean(options.signal?.aborted), Math.max(0, deadline - Date.now()));
    const graceUntil = Math.min(deadline, Date.now() + VOLUME_GRACE_MS);
    await waitFor(() => count('trade') >= want || Boolean(options.signal?.aborted), Math.max(0, graceUntil - Date.now()));

    const readings: ContractReading[] = refs.map((r) => {
      const state = feed.states.get(r.streamerSymbol);
      const oi = state?.summary?.openInterest;
      const volume = state?.trade?.dayVolume;
      return {
        strike: r.strike,
        openInterest: finite(oi) ? oi : null,
        volume: finite(volume) ? volume : null,
      };
    });
    return toRow(stock, refs.length, readings, count('summary'), count('trade'), Date.now() - started);
  } finally {
    feed.release(added);
  }
}

function toRow(
  stock: string,
  contracts: number,
  readings: ContractReading[],
  summaries: number,
  trades: number,
  ms: number,
): StrikesRow {
  const top = topStrikes(readings);
  const oiReported = readings.filter((r) => r.openInterest !== null).length;
  const volumeReported = readings.filter((r) => r.volume !== null).length;
  const notes: string[] = [];

  /*
   * An empty field across a whole chain is almost always a renamed field, not
   * a market with no open interest — say which name was read, in the server
   * log for fixing and on the row for seeing.
   */
  if (oiReported === 0) {
    const why = summaries === 0 ? 'no Summary events arrived' : `${summaries} Summary events arrived, all without it`;
    console.warn(`[lab/strikes] ${stock}: open interest empty — field tried: ${OI_FIELD} (${why}).`);
    notes.push(`OI empty (tried ${OI_FIELD}; ${why})`);
  } else if (oiReported < contracts) {
    notes.push(`OI from ${oiReported}/${contracts} contracts`);
  }
  if (volumeReported === 0) {
    const why = trades === 0 ? 'no Trade events arrived' : `${trades} Trade events arrived, all without it`;
    console.warn(`[lab/strikes] ${stock}: volume empty — field tried: ${VOLUME_FIELD} (${why}).`);
    notes.push(`volume empty (tried ${VOLUME_FIELD}; ${why})`);
  } else if (volumeReported < contracts) {
    notes.push(`volume from ${volumeReported}/${contracts} contracts`);
  }

  return {
    stock,
    status: top.oi || top.volume ? 'ok' : 'error',
    topOiStrike: top.oi?.strike ?? null,
    topOi: top.oi?.value ?? null,
    topVolumeStrike: top.volume?.strike ?? null,
    topVolume: top.volume?.value ?? null,
    contracts,
    oiReported,
    volumeReported,
    note: notes.length ? notes.join('; ') : null,
    ms,
  };
}
