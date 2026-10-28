import { addDays, isExpired, marketToday } from '../time';

/**
 * `/lab`'s Strikes tab: for each pasted ticker, the one strike with the most
 * open interest and the one with the most volume today, over the contracts
 * expiring within a day window. Pure; no I/O — the live run is in
 * `./strikesRun`, and the page imports the list parsing and CSV from here.
 *
 * ## One strike, summed across expirations
 *
 * A strike's open interest (or volume) is the sum over every contract at that
 * strike inside the window — every expiration, and calls and puts both unless
 * the side toggle narrows it. So "top-OI strike 450" means more contracts are
 * open at 450 across the window than at any other single price. Ties go to the
 * lower strike, so a rerun on identical numbers names the same strike.
 */

export type StrikesSide = 'all' | 'calls' | 'puts';

export const STRIKES_SIDES: ReadonlyArray<{ id: StrikesSide; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'calls', label: 'Calls only' },
  { id: 'puts', label: 'Puts only' },
];

export const STRIKES_DEFAULT_WINDOW_DAYS = 60;
export const STRIKES_MAX_WINDOW_DAYS = 3650;
/** Tickers per run. Past this a run would hold the feed for longer than anyone waits. */
export const STRIKES_MAX_TICKERS = 200;

/**
 * The dxFeed fields read, named once. If a run logs one of these as empty
 * across a whole chain, this is the name to change — and the matching entry in
 * `EVENT_FIELDS` in `./dxlink`, which tells dxLink which fields to send.
 */
export const OI_FIELD = 'Summary.openInterest';
export const VOLUME_FIELD = 'Trade.dayVolume';

const TICKER = /^[A-Z][A-Z0-9./-]{0,9}$/;

/**
 * The textarea → tickers: comma-, newline- or space-separated, upper-cased,
 * duplicates dropped in first-seen order. Anything that cannot be a ticker is
 * returned separately so the page can say what it skipped.
 */
export function parseTickerList(text: string): { tickers: string[]; rejected: string[] } {
  const tickers: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const t = raw.trim().replace(/^\$/, '').toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    (TICKER.test(t) ? tickers : rejected).push(t);
  }
  return { tickers, rejected };
}

/** A usable window in whole days, or the default. */
export function normaliseWindowDays(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return STRIKES_DEFAULT_WINDOW_DAYS;
  return Math.min(n, STRIKES_MAX_WINDOW_DAYS);
}

export function normaliseSide(value: unknown): StrikesSide {
  return value === 'calls' || value === 'puts' ? value : 'all';
}

/**
 * Live (not past its 16:00 ET close) and expiring no later than `windowDays`
 * New York calendar days from today. A window of 0 is today's expiration only.
 */
export function inWindow(expiration: string, windowDays: number, now: Date = new Date()): boolean {
  if (isExpired(expiration, now)) return false;
  return expiration <= addDays(marketToday(now), windowDays);
}

export function sideMatches(type: 'call' | 'put', side: StrikesSide): boolean {
  return side === 'all' || (side === 'calls' ? type === 'call' : type === 'put');
}

/** One contract's numbers off the feed; null when the event or field never arrived. */
export interface ContractReading {
  strike: number;
  openInterest: number | null;
  volume: number | null;
}

export interface StrikeTop {
  strike: number;
  value: number;
}

/** Per-strike sums, then the largest. Null when no contract carried the number at all. */
export function topStrikes(readings: readonly ContractReading[]): { oi: StrikeTop | null; volume: StrikeTop | null } {
  const pick = (field: 'openInterest' | 'volume'): StrikeTop | null => {
    const byStrike = new Map<number, number>();
    for (const r of readings) {
      const v = r[field];
      if (v === null || !Number.isFinite(v) || v < 0) continue;
      byStrike.set(r.strike, (byStrike.get(r.strike) ?? 0) + v);
    }
    let best: StrikeTop | null = null;
    for (const [strike, value] of byStrike) {
      if (!best || value > best.value || (value === best.value && strike < best.strike)) best = { strike, value };
    }
    return best;
  };
  return { oi: pick('openInterest'), volume: pick('volume') };
}

/** One output row, as the route streams it and the table renders it. */
export interface StrikesRow {
  stock: string;
  status: 'ok' | 'error';
  topOiStrike: number | null;
  topOi: number | null;
  topVolumeStrike: number | null;
  topVolume: number | null;
  /** Contracts in the window and side. */
  contracts: number;
  /** How many of those reported each number before the ticker's timeout. */
  oiReported: number;
  volumeReported: number;
  /** Why the row is partial or empty, or what failed. */
  note: string | null;
  ms: number;
}

const CSV_HEADER = ['stock', 'top_oi_strike', 'top_oi', 'top_volume_strike', 'top_volume', 'contracts', 'status', 'note'];

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: readonly StrikesRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [r.stock, r.topOiStrike, r.topOi, r.topVolumeStrike, r.topVolume, r.contracts, r.status, r.note]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
