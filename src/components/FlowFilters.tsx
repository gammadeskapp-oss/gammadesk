'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { InfoTip } from './InfoTip';
import { TickerLink } from './TickerLink';
import type { FlowRow, UnusualLevel } from '@/lib/flow/types';
import { formatContracts, formatStrike, formatUsd } from '@/lib/format';

/**
 * Filter bar and results table for /flow.
 *
 * Everything filters in memory over rows the server already sent — the table
 * is capped at sixty rows, so shipping them all costs less than a single
 * refetch would, and typing never touches the network.
 *
 * Filter state lives in the URL rather than component state, so a filtered
 * view is shareable and survives a refresh. `router.replace` keeps it out of
 * the back-button history, which otherwise fills up with one entry per
 * keystroke.
 */

const LEVEL: Record<UnusualLevel, { text: string; label: string }> = {
  extreme: { text: 'text-bear', label: 'EXTREME' },
  high: { text: 'text-flip', label: 'HIGH' },
  notable: { text: 'text-term-dim', label: 'NOTABLE' },
};

type Side = 'both' | 'calls' | 'puts';
type Expiry = 'all' | '0dte' | 'week' | 'month';

const PREMIUM_CHIPS = [
  { value: 0, label: 'Any' },
  { value: 50_000, label: '$50k' },
  { value: 250_000, label: '$250k' },
  { value: 1_000_000, label: '$1M' },
];

const EXPIRY_CHIPS: { value: Expiry; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '0dte', label: '0DTE' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

const SIDE_CHIPS: { value: Side; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'calls', label: 'Calls' },
  { value: 'puts', label: 'Puts' },
];

// --- date helpers -------------------------------------------------------------

/**
 * Window ends, derived from the session date the server passed down.
 *
 * Pure string arithmetic on `YYYY-MM-DD` via UTC, so the browser's own time
 * zone never shifts a boundary — a user in Tokyo and one in Chicago get the
 * same "this week".
 */
function endOfWeek(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  // Friday is the last expiry of a normal week; Sunday counts as the week
  // that is about to start, not the one that just ended.
  const dow = d.getUTCDay();
  const toFriday = dow === 0 ? 5 : 5 - dow;
  d.setUTCDate(d.getUTCDate() + Math.max(0, toFriday));
  return d.toISOString().slice(0, 10);
}

function endOfMonth(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

// --- component ----------------------------------------------------------------

export function FlowFilters({
  rows,
  today,
  head,
  cell,
}: {
  rows: FlowRow[];
  /** New York session date, so week and month boundaries match the data. */
  today: string;
  head: string;
  cell: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const side = (params.get('side') as Side) || 'both';
  const expiry = (params.get('expiry') as Expiry) || 'all';
  const minPremium = Number(params.get('minPremium') ?? 0) || 0;
  const urlTicker = params.get('ticker') ?? '';

  /*
   * The text box is the one control held locally as well as in the URL.
   * Writing a URL per keystroke would make typing feel like navigation; this
   * echoes immediately and pushes the debounced value.
   */
  const [tickerText, setTickerText] = useState(urlTicker);
  const lastPushed = useRef(urlTicker);

  // Keep the box in step when the URL changes from elsewhere — clear-all, or
  // the back button — without clobbering what is being typed.
  useEffect(() => {
    if (urlTicker !== lastPushed.current) {
      lastPushed.current = urlTicker;
      setTickerText(urlTicker);
    }
  }, [urlTicker]);

  const setParams = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    }
    const query = merged.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = tickerText.trim();
      if (trimmed === lastPushed.current) return;
      lastPushed.current = trimmed;
      setParams({ ticker: trimmed || null });
    }, 150);
    return () => clearTimeout(handle);
    // `setParams` closes over the current params, which is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerText]);

  const [sheetOpen, setSheetOpen] = useState(false);

  // --- filtering ---
  const wanted = useMemo(
    () =>
      tickerText
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    [tickerText],
  );

  const filtered = useMemo(() => {
    const weekEnd = endOfWeek(today);
    const monthEnd = endOfMonth(today);

    return rows.filter((r) => {
      // Partial match, so "NV" finds NVDA while a full symbol still works.
      if (wanted.length > 0 && !wanted.some((w) => r.symbol.includes(w))) return false;
      if (side === 'calls' && r.type !== 'call') return false;
      if (side === 'puts' && r.type !== 'put') return false;

      if (expiry === '0dte' && r.expiration !== today) return false;
      if (expiry === 'week' && r.expiration > weekEnd) return false;
      if (expiry === 'month' && r.expiration > monthEnd) return false;

      // An unknown premium is excluded rather than treated as zero, which
      // would let it pass every threshold.
      if (minPremium > 0 && (r.premium === null || r.premium < minPremium)) return false;

      return true;
    });
  }, [rows, wanted, side, expiry, minPremium, today]);

  const activeCount =
    (wanted.length > 0 ? 1 : 0) +
    (side !== 'both' ? 1 : 0) +
    (expiry !== 'all' ? 1 : 0) +
    (minPremium > 0 ? 1 : 0);

  const clearAll = () => {
    setTickerText('');
    lastPushed.current = '';
    setParams({ ticker: null, side: null, expiry: null, minPremium: null });
  };

  const chip = (active: boolean) =>
    `border px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] transition-colors ${
      active
        ? 'border-pos/60 bg-pos/15 text-pos'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  const controls = (
    <div className="space-y-3">
      <div>
        <label htmlFor="flow-ticker" className="label-xs block">
          Ticker
        </label>
        <input
          id="flow-ticker"
          type="search"
          value={tickerText}
          onChange={(e) => setTickerText(e.target.value.toUpperCase())}
          placeholder="NVDA, SPY, TSLA"
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full border border-term-edge bg-term-panel px-3 py-1.5 text-xs tracking-[0.12em] text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none focus:ring-1 focus:ring-pos/40 sm:w-56"
        />
      </div>

      <div>
        <span className="label-xs block">Side</span>
        <div role="group" aria-label="Side" className="mt-1 flex flex-wrap gap-1">
          {SIDE_CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={side === c.value}
              onClick={() => setParams({ side: c.value === 'both' ? null : c.value })}
              className={chip(side === c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label-xs block">Expiry</span>
        <div role="group" aria-label="Expiry" className="mt-1 flex flex-wrap gap-1">
          {EXPIRY_CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={expiry === c.value}
              onClick={() => setParams({ expiry: c.value === 'all' ? null : c.value })}
              className={chip(expiry === c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label-xs flex items-center gap-1.5">
          Min premium
          <InfoTip for="flowPremium" />
        </span>
        <div role="group" aria-label="Minimum premium" className="mt-1 flex flex-wrap gap-1">
          {PREMIUM_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={minPremium === c.value}
              onClick={() => setParams({ minPremium: c.value ? String(c.value) : null })}
              className={chip(minPremium === c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/*
        Deliberately disabled rather than omitted, so it is clear this was
        considered. A sweep is an execution type — one order routed across
        several exchanges at once — and it is only knowable from a live trade
        tape with condition codes. Cboe's delayed feed is an end-of-day quote
        snapshot: bid, ask, volume, open interest and greeks, with no trade
        metadata at all. Any "sweeps only" toggle here would be guessing.
      */}
      <div>
        <span className="label-xs block">Sweeps only</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled
            aria-disabled
            className="cursor-not-allowed border border-term-line/60 px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-term-faint/50"
          >
            Off
          </button>
          <span className="text-2xs text-term-faint">
            Needs a live trade feed — this source has no execution data.
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Mobile: one button opening a sheet. Desktop: the bar itself. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          className="w-full border border-term-edge bg-term-panel px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-term-dim"
        >
          Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
      </div>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col lg:hidden">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setSheetOpen(false)}
            className="flex-1 bg-black/60"
          />
          <div className="max-h-[80vh] overflow-y-auto border-t border-term-edge bg-term-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-term-text">
                Filters
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="border border-term-line px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim"
              >
                Done
              </button>
            </div>
            {controls}
          </div>
        </div>
      )}

      <div className="panel hidden px-3.5 py-3 lg:block">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">{controls}</div>
      </div>

      {/* Count and clear, always visible so an empty table is explainable. */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-2xs text-term-faint">
          <span className="text-term-dim">{filtered.length}</span> of {rows.length}{' '}
          contracts
        </p>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="border border-flip/50 bg-flip/10 px-3 py-1 text-2xs font-bold uppercase tracking-[0.12em] text-flip transition-colors hover:bg-flip/20"
          >
            Clear all · {activeCount}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          <p className="text-term-text">No flow matches these filters.</p>
          <p className="mx-auto mt-2 max-w-md leading-relaxed">
            {rows.length} contracts were flagged today; none of them match what
            you have selected.
          </p>
          <button
            type="button"
            onClick={clearAll}
            className="mt-4 border border-pos/50 bg-pos/10 px-4 py-2 text-2xs font-bold uppercase tracking-[0.14em] text-pos transition-colors hover:bg-pos/20"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <section className="panel">
          <div className="scroll-term max-h-[70vh] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
              <caption className="sr-only">
                Contracts trading heavily relative to their open interest.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={`${head} text-left`}>Ticker</th>
                  <th scope="col" className={head}>Expiry</th>
                  <th scope="col" className={head}>Strike</th>
                  <th scope="col" className={head}>Type</th>
                  <th scope="col" className={head}>Volume</th>
                  <th scope="col" className={head}>Open int.</th>
                  <th scope="col" className={head}>Premium</th>
                  <th scope="col" className={head}>Vol/OI</th>
                  <th scope="col" className={`${head} text-left`}>Flag</th>
                  <th scope="col" className={`${head} text-left`}>What happened</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const tone = LEVEL[r.level];
                  return (
                    <tr key={`${r.symbol}-${r.expiration}-${r.strike}-${r.type}`}>
                      <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                        <TickerLink symbol={r.symbol} />
                      </th>
                      <td className={`${cell} text-term-dim`}>{r.expiryLabel}</td>
                      <td className={`${cell} text-term-text`}>{formatStrike(r.strike)}</td>
                      <td
                        className={`${cell} font-bold ${
                          r.type === 'call' ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        {r.type === 'call' ? 'CALL' : 'PUT'}
                      </td>
                      <td className={`${cell} text-term-text`}>
                        {formatContracts(r.volume)}
                      </td>
                      <td className={`${cell} text-term-dim`}>
                        {formatContracts(r.openInterest)}
                      </td>
                      <td className={`${cell} text-term-dim`}>
                        {r.premium === null ? '—' : formatUsd(r.premium)}
                      </td>
                      <td className={`${cell} font-bold ${tone.text}`}>
                        {r.volumeToOi >= 100
                          ? `${Math.floor(r.volumeToOi)}x`
                          : `${r.volumeToOi.toFixed(1)}x`}
                      </td>
                      <td className={`${cell} text-left`}>
                        <span
                          className={`border px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] ${tone.text} border-current/40`}
                        >
                          {tone.label}
                        </span>
                      </td>
                      <td className={`${cell} max-w-[26rem] text-left text-2xs text-term-dim`}>
                        {r.note}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
