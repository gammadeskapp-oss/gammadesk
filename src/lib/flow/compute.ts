import 'server-only';

import { parseOccSymbol } from '../cboe';
import { runScan, scanSymbols } from '../scanUniverse';
import { formatExpiryLabel, formatAsOf, isExpired, marketToday } from '../time';
import { FLOW_SCHEMA } from './types';
import {
  LARGE_PREMIUM_USD,
  MIN_OI,
  MIN_RATIO,
  MIN_VOLUME,
  PER_SYMBOL_CAP,
  TOTAL_CAP,
} from './types';
import type { FlowRow, FlowSnapshot, FlowSymbolSummary } from './types';
import { flagFor, multiLegNote, shortNote, unusualScore } from './score';

/**
 * Unusual options activity across the tracked symbols.
 *
 * A row earns its place one of two ways: it traded more than its own open
 * interest (unusual by ratio), or more than a quarter-million dollars changed
 * hands in it (large by money). Open interest is yesterday's settled position
 * count, so a contract trading more than its own open interest in a session
 * means most of today's activity is opening new exposure; the dollars path
 * catches the big print that a ratio gate alone would drop. The table then
 * ranks by dollars, because that is what a reader is really asking "where did
 * the money go today".
 *
 * A true "versus recent average volume" screen is still not possible here —
 * Cboe publishes today's volume but no history of it, so it would take a stored
 * daily series this app does not keep. That is stated on the page rather than
 * papered over with a worse proxy.
 *
 * None of this says who traded, or in which direction. A large print can be an
 * opening buy, an opening sell, a hedge leg, or a roll. The page labels the
 * output as activity, not signal.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';



interface CboeContract {
  option?: string;
  volume?: number;
  open_interest?: number;
  bid?: number;
  ask?: number;
  last_trade_price?: number;
}

/**
 * What the contract traded for, per share.
 *
 * Mid when both sides are quoted; the last print otherwise. Returns null
 * rather than zero when neither is usable, so an unknown premium is excluded
 * from a minimum-premium filter instead of silently passing as $0.
 */
function contractPrice(c: CboeContract): number | null {
  const bid = Number(c.bid ?? 0);
  const ask = Number(c.ask ?? 0);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  const last = Number(c.last_trade_price ?? 0);
  return last > 0 ? last : null;
}

interface CboePayload {
  data?: {
    current_price?: number;
    close?: number;
    /** Underlying's last print, New York time, e.g. `2026-08-14T10:39:22`. */
    last_trade_time?: string;
    options?: CboeContract[];
  };
}

async function scanSymbol(
  symbol: string,
): Promise<{ rows: FlowRow[]; summary: FlowSymbolSummary; session: string | null }> {
  const empty: FlowSymbolSummary = {
    symbol,
    spot: 0,
    totalVolume: 0,
    totalOpenInterest: 0,
    contracts: 0,
    flagged: 0,
    putCallVolume: null,
  };

  let payload: CboePayload;
  try {
    const res = await fetch(
      `https://cdn-api.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
      {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      // 429 is named explicitly because it means something actionable — the
      // list is longer than the CDN's per-window quota — rather than "the
      // chain is broken".
      const failed =
        res.status === 429
          ? 'Rate limited by Cboe — the scan list is longer than one window allows.'
          : `Cboe returned HTTP ${res.status}.`;
      return { rows: [], summary: { ...empty, failed }, session: null };
    }
    payload = (await res.json()) as CboePayload;
  } catch (error) {
    return {
      rows: [],
      summary: {
        ...empty,
        failed: error instanceof Error ? error.message : 'Chain request failed.',
      },
      session: null,
    };
  }

  const data = payload.data;
  const spot = data?.current_price || data?.close || 0;
  const contracts = data?.options ?? [];
  if (spot <= 0 || contracts.length === 0) {
    return {
      rows: [],
      summary: { ...empty, failed: 'No chain data returned.' },
      session: null,
    };
  }

  // Already New York time and already a date-first ISO string, so the day is
  // the first ten characters. No conversion, nothing to get wrong.
  const session = data?.last_trade_time?.slice(0, 10) ?? null;

  const candidates: FlowRow[] = [];

  let totalVolume = 0;
  let totalOpenInterest = 0;
  let callVolume = 0;
  let putVolume = 0;

  for (const c of contracts) {
    const volume = Number(c.volume ?? 0);
    const openInterest = Number(c.open_interest ?? 0);
    if (Number.isFinite(volume)) totalVolume += volume;
    if (Number.isFinite(openInterest)) totalOpenInterest += openInterest;

    if (!c.option) continue;
    const parsed = parseOccSymbol(c.option);
    if (!parsed) continue;

    if (parsed.type === 'call') callVolume += volume;
    else putVolume += volume;

    // Expired contracts still appear in the feed — including today's 0DTE once
    // the close has passed, which is when this scan runs.
    if (isExpired(parsed.expiration)) continue;
    if (volume < MIN_VOLUME || openInterest < MIN_OI) continue;

    const ratio = volume / openInterest;
    const price = contractPrice(c);
    const premium = price === null ? null : volume * price * 100;

    // Two ways onto the table: unusual by ratio, or large by money. The second
    // path is what makes a premium-ranked screen honest — a $2M print at 2x its
    // open interest is exactly the kind of flow a ratio-only gate would drop.
    const unusualByRatio = ratio >= MIN_RATIO;
    const largeByMoney = premium !== null && premium >= LARGE_PREMIUM_USD;
    if (!unusualByRatio && !largeByMoney) continue;

    const distancePct = ((parsed.strike - spot) / spot) * 100;

    candidates.push({
      symbol,
      expiration: parsed.expiration,
      expiryLabel: formatExpiryLabel(parsed.expiration),
      strike: parsed.strike,
      type: parsed.type,
      volume,
      openInterest,
      volumeToOi: ratio,
      premium,
      unusualScore: unusualScore({ premium, volumeToOi: ratio, distancePct }),
      shareOfChain: 0, // filled once the chain total is known
      flag: flagFor({ volumeToOi: ratio, premium }),
      note: shortNote({
        premium,
        volume,
        openInterest,
        volumeToOi: ratio,
        type: parsed.type,
        distancePct,
      }),
      multiLegNote: multiLegNote({ distancePct, volume }),
      spot,
      distancePct,
    });
  }

  const rows = candidates
    .map((r) => ({
      ...r,
      shareOfChain: totalVolume > 0 ? (r.volume / totalVolume) * 100 : 0,
    }))
    // Rank by dollars first, then the score, then raw volume, so the biggest
    // money leads and a null premium cannot outrank a known one.
    .sort(
      (a, b) =>
        (b.premium ?? -1) - (a.premium ?? -1) ||
        b.unusualScore - a.unusualScore ||
        b.volume - a.volume,
    )
    .slice(0, PER_SYMBOL_CAP);

  return {
    session,
    rows,
    summary: {
      symbol,
      spot,
      totalVolume,
      totalOpenInterest,
      contracts: contracts.length,
      flagged: rows.length,
      putCallVolume: callVolume > 0 ? putVolume / callVolume : null,
    },
  };
}

export async function computeFlowSnapshot(): Promise<FlowSnapshot> {
  const symbols = scanSymbols();

  // Waves, pacing and the time budget all live in `scanUniverse`, so /flow and
  // /velocity cannot drift into scanning at different rates.
  const { results, covered, skipped } = await runScan(symbols, scanSymbol);

  const rows = results.flatMap((r) => r.rows);
  const summaries = results.map((r) => r.summary);

  /*
   * The session every chain agrees on, taken as the most common rather than
   * the first: a thin name whose last print is stale would otherwise date the
   * whole scan wrongly. Falls back to the wall clock only if no chain reported
   * one at all.
   */
  const tally = new Map<string, number>();
  for (const { session } of results) {
    if (session) tally.set(session, (tally.get(session) ?? 0) + 1);
  }
  const sessionDate =
    [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? marketToday();

  const failed = summaries.filter((s) => s.failed);
  const notes: string[] = [];
  if (failed.length > 0) {
    notes.push(
      `${failed.length} of ${covered.length} chains could not be read: ${failed
        .map((f) => f.symbol)
        .join(', ')}.`,
    );
  }
  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} of ${symbols.length} symbols were not reached: ${skipped.join(', ')}. ` +
        'Cboe allows about sixty chains per window, so a longer list scans the same sixty. ' +
        'Edit lib/scanUniverse.ts to drop names, or move the ones you care about nearer the top.',
    );
  }

  const now = new Date();

  return {
    schema: FLOW_SCHEMA,
    sessionDate,
    rows: rows
      .sort(
        (a, b) =>
          (b.premium ?? -1) - (a.premium ?? -1) ||
          b.unusualScore - a.unusualScore ||
          b.volume - a.volume,
      )
      .slice(0, TOTAL_CAP),
    symbols: summaries.sort((a, b) => b.totalVolume - a.totalVolume),
    asOfLabel: formatAsOf(now),
    computedAt: now.toISOString(),
    scanned: covered.length,
    universe: symbols.length,
    notes,
  };
}
