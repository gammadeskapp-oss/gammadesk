import 'server-only';

import { parseOccSymbol } from '../cboe';
import { allTrackedSymbols } from '../groups/definitions';
import { formatExpiryLabel, formatAsOf, marketToday } from '../time';
import type { FlowRow, FlowSnapshot, FlowSymbolSummary, UnusualLevel } from './types';

/**
 * Unusual options activity across the tracked symbols.
 *
 * The measure is volume relative to open interest. Open interest is yesterday's
 * settled position count, so a contract trading more than its own open interest
 * in a single session means most of today's activity is opening new exposure
 * rather than shuffling existing positions. That is the standard screen, and it
 * is the only one available here — Cboe publishes today's volume but no history
 * of it, so a true "versus recent average volume" comparison is not possible
 * without storing our own daily series. That limitation is stated on the page
 * rather than papered over with a worse proxy.
 *
 * None of this says who traded, or in which direction. A large print can be an
 * opening buy, an opening sell, a hedge leg, or a roll. The page labels the
 * output as activity, not signal.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Contracts below this volume are noise regardless of ratio. */
const MIN_VOLUME = 250;
/** Below this ratio nothing is unusual enough to report. */
const MIN_RATIO = 1.0;
/** Guards against a ratio blowing up on a contract with almost no open interest. */
const MIN_OI = 50;
/** Most rows kept per symbol, so one busy name cannot swamp the table. */
const PER_SYMBOL_CAP = 6;
/** Overall table cap. */
const TOTAL_CAP = 60;

interface CboeContract {
  option?: string;
  volume?: number;
  open_interest?: number;
}

interface CboePayload {
  data?: {
    current_price?: number;
    close?: number;
    options?: CboeContract[];
  };
}

function levelFor(ratio: number): UnusualLevel {
  if (ratio >= 10) return 'extreme';
  if (ratio >= 3) return 'high';
  return 'notable';
}

function noteFor(row: {
  ratio: number;
  volume: number;
  openInterest: number;
  type: 'call' | 'put';
  distancePct: number;
}): string {
  const side = row.type === 'call' ? 'calls' : 'puts';
  const where =
    Math.abs(row.distancePct) < 1
      ? 'right at the money'
      : `${Math.abs(row.distancePct).toFixed(1)}% ${row.distancePct > 0 ? 'above' : 'below'} spot`;

  const multiple =
    row.ratio >= 10
      ? `over ${Math.floor(row.ratio)}x`
      : `${row.ratio.toFixed(1)}x`;

  return (
    `${row.volume.toLocaleString('en-US')} ${side} traded against ` +
    `${row.openInterest.toLocaleString('en-US')} already open — ${multiple} the ` +
    `existing position, ${where}.`
  );
}

async function scanSymbol(
  symbol: string,
): Promise<{ rows: FlowRow[]; summary: FlowSymbolSummary }> {
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
      `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
      {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      return { rows: [], summary: { ...empty, failed: `Cboe returned HTTP ${res.status}.` } };
    }
    payload = (await res.json()) as CboePayload;
  } catch (error) {
    return {
      rows: [],
      summary: {
        ...empty,
        failed: error instanceof Error ? error.message : 'Chain request failed.',
      },
    };
  }

  const data = payload.data;
  const spot = data?.current_price || data?.close || 0;
  const contracts = data?.options ?? [];
  if (spot <= 0 || contracts.length === 0) {
    return { rows: [], summary: { ...empty, failed: 'No chain data returned.' } };
  }

  const today = marketToday();
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

    // Expired contracts still appear in the feed; they cannot be today's flow.
    if (parsed.expiration < today) continue;
    if (volume < MIN_VOLUME || openInterest < MIN_OI) continue;

    const ratio = volume / openInterest;
    if (ratio < MIN_RATIO) continue;

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
      shareOfChain: 0, // filled once the chain total is known
      level: levelFor(ratio),
      note: noteFor({ ratio, volume, openInterest, type: parsed.type, distancePct }),
      spot,
      distancePct,
    });
  }

  const rows = candidates
    .map((r) => ({
      ...r,
      shareOfChain: totalVolume > 0 ? (r.volume / totalVolume) * 100 : 0,
    }))
    // Rank by ratio, then raw size, so a genuinely large print outranks a
    // high ratio on a small contract.
    .sort((a, b) => b.volumeToOi - a.volumeToOi || b.volume - a.volume)
    .slice(0, PER_SYMBOL_CAP);

  return {
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

/** Symbols scanned at once. Chains are megabytes each, so this stays small. */
const WAVE = 3;

export async function computeFlowSnapshot(): Promise<FlowSnapshot> {
  const symbols = allTrackedSymbols();
  const rows: FlowRow[] = [];
  const summaries: FlowSymbolSummary[] = [];

  for (let i = 0; i < symbols.length; i += WAVE) {
    const wave = await Promise.all(symbols.slice(i, i + WAVE).map(scanSymbol));
    for (const result of wave) {
      rows.push(...result.rows);
      summaries.push(result.summary);
    }
  }

  const failed = summaries.filter((s) => s.failed);
  const notes: string[] = [];
  if (failed.length > 0) {
    notes.push(
      `${failed.length} of ${symbols.length} chains could not be read: ${failed
        .map((f) => f.symbol)
        .join(', ')}.`,
    );
  }

  const now = new Date();

  return {
    rows: rows
      .sort((a, b) => b.volumeToOi - a.volumeToOi || b.volume - a.volume)
      .slice(0, TOTAL_CAP),
    symbols: summaries.sort((a, b) => b.totalVolume - a.totalVolume),
    asOfLabel: formatAsOf(now),
    computedAt: now.toISOString(),
    scanned: symbols.length,
    notes,
  };
}
