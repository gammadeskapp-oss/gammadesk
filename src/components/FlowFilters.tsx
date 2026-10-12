'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { InfoTip } from './InfoTip';
import { TickerLink } from './TickerLink';
import type { FlowFlag, FlowRow } from '@/lib/flow/types';
import { DEFAULT_MIN_PREMIUM_USD } from '@/lib/flow/types';
import { flowTotals, groupByTicker, topTickers } from '@/lib/flow/group';
import { formatContracts, formatStrike, formatUsd } from '@/lib/format';

/**
 * Filter bar, summary strip and grouped results table for /flow.
 *
 * Everything filters and groups in memory over rows the server already sent —
 * the table is capped, so shipping them all costs less than a single refetch
 * and typing never touches the network.
 *
 * Filter state is held locally and mirrored into the URL with
 * `history.replaceState` (not `router.replace`), so a filtered view is still
 * shareable and survives a refresh without re-running the force-dynamic server
 * component on every keystroke.
 */

const FLAG: Record<'extreme' | 'large', { text: string; label: string }> = {
  extreme: { text: 'text-bear', label: 'EXTREME' },
  large: { text: 'text-flip', label: 'LARGE' },
};

type Side = 'both' | 'calls' | 'puts';
type Expiry = 'all' | '0dte' | 'week' | 'month';
type View = 'grouped' | 'flat';

/**
 * Premium filter steps. `null` is "Any" and is distinct from the default: the
 * screen hides sub-$50k rows out of the box, so "Any" is the one choice that
 * shows them (and rows whose premium could not be priced at all).
 */
const PREMIUM_CHIPS: { value: number; label: string }[] = [
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
 * Window ends, derived from the session date the server passed down. Pure
 * string arithmetic on `YYYY-MM-DD` via UTC, so the browser's own time zone
 * never shifts a boundary.
 */
function endOfWeek(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
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

// --- small presentational pieces ---------------------------------------------

/** Horizontal call-vs-put money bar. Bull (calls) left, bear (puts) right. */
function SplitBar({ call, put, height = 'h-1.5' }: { call: number; put: number; height?: string }) {
  const total = call + put;
  const callPct = total > 0 ? (call / total) * 100 : 50;
  return (
    <div className={`flex w-full overflow-hidden rounded-sm bg-bear ${height}`}>
      <div className="h-full bg-bull" style={{ width: `${callPct}%` }} aria-hidden />
    </div>
  );
}

function FlagBadge({ flag }: { flag: FlowFlag }) {
  if (flag === null) return <span className="text-term-faint">—</span>;
  const f = FLAG[flag];
  return (
    <span
      className={`border px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] ${f.text} border-current/40`}
    >
      {f.label}
    </span>
  );
}

function ratioLabel(r: number): string {
  return r >= 100 ? `${Math.floor(r)}x` : `${r.toFixed(1)}x`;
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
  const initial = useSearchParams();

  const [side, setSide] = useState<Side>(() => {
    const v = initial.get('side');
    return v === 'calls' || v === 'puts' ? v : 'both';
  });
  const [expiry, setExpiry] = useState<Expiry>(() => {
    const v = initial.get('expiry');
    return v === '0dte' || v === 'week' || v === 'month' ? v : 'all';
  });
  // Absent from the URL means the default hide (<$50k); an explicit `0` means
  // the reader chose "Any" and wants everything, including unpriced rows.
  const [minPremium, setMinPremium] = useState<number>(() => {
    const raw = initial.get('minPremium');
    return raw === null ? DEFAULT_MIN_PREMIUM_USD : Number(raw) || 0;
  });
  const [tickerText, setTickerText] = useState(() => initial.get('ticker') ?? '');
  const [view, setView] = useState<View>(() =>
    initial.get('view') === 'flat' ? 'flat' : 'grouped',
  );

  const [tickerApplied, setTickerApplied] = useState(tickerText);

  useEffect(() => {
    const handle = setTimeout(() => setTickerApplied(tickerText.trim()), 150);
    return () => clearTimeout(handle);
  }, [tickerText]);

  // Mirror to the address bar. No navigation, so no server round-trip.
  useEffect(() => {
    const merged = new URLSearchParams(window.location.search);
    const write = (key: string, value: string | null) => {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    };
    write('ticker', tickerApplied || null);
    write('side', side === 'both' ? null : side);
    write('expiry', expiry === 'all' ? null : expiry);
    // The default is kept out of the URL; "Any" (0) and the higher steps are written.
    write('minPremium', minPremium === DEFAULT_MIN_PREMIUM_USD ? null : String(minPremium));
    write('view', view === 'grouped' ? null : view);

    const query = merged.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [tickerApplied, side, expiry, minPremium, view]);

  const [sheetOpen, setSheetOpen] = useState(false);

  const wanted = useMemo(
    () =>
      tickerApplied
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    [tickerApplied],
  );

  const filtered = useMemo(() => {
    const weekEnd = endOfWeek(today);
    const monthEnd = endOfMonth(today);

    return rows.filter((r) => {
      if (wanted.length > 0 && !wanted.some((w) => r.symbol.includes(w))) return false;
      if (side === 'calls' && r.type !== 'call') return false;
      if (side === 'puts' && r.type !== 'put') return false;

      if (expiry === '0dte' && r.expiration !== today) return false;
      if (expiry === 'week' && r.expiration > weekEnd) return false;
      if (expiry === 'month' && r.expiration > monthEnd) return false;

      // An unknown premium is excluded rather than treated as zero, which would
      // let it pass every threshold. "Any" (0) keeps it.
      if (minPremium > 0 && (r.premium === null || r.premium < minPremium)) return false;

      return true;
    });
  }, [rows, wanted, side, expiry, minPremium, today]);

  const groups = useMemo(() => groupByTicker(filtered), [filtered]);
  const totals = useMemo(() => flowTotals(filtered), [filtered]);
  const top = useMemo(() => topTickers(groups, 5), [groups]);

  const activeCount =
    (wanted.length > 0 ? 1 : 0) +
    (side !== 'both' ? 1 : 0) +
    (expiry !== 'all' ? 1 : 0) +
    (minPremium !== DEFAULT_MIN_PREMIUM_USD ? 1 : 0);

  const clearAll = () => {
    setTickerText('');
    setTickerApplied('');
    setSide('both');
    setExpiry('all');
    setMinPremium(DEFAULT_MIN_PREMIUM_USD);
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
              onClick={() => setSide(c.value)}
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
              onClick={() => setExpiry(c.value)}
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
              onClick={() => setMinPremium(c.value)}
              className={chip(minPremium === c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-2xs text-term-faint">
          Hidden below $50k by default. &ldquo;Any&rdquo; also shows rows whose
          premium could not be priced.
        </p>
      </div>

      {/*
        Deliberately disabled rather than omitted. A sweep is an execution type
        — one order routed across several exchanges at once — knowable only from
        a live trade tape with condition codes. Cboe's delayed feed is an
        end-of-day quote snapshot with no trade metadata, so any "sweeps only"
        toggle here would be guessing.
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

      {/* Day's money summary, over the rows currently shown. */}
      <SummaryBar totals={totals} top={top} count={filtered.length} />

      {/* Count, view toggle, and clear — always visible so an empty table is explainable. */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-2xs text-term-faint">
          <span className="text-term-dim">{filtered.length}</span> of {rows.length}{' '}
          contracts
          {view === 'grouped' && groups.length > 0 && (
            <>
              {' '}
              · <span className="text-term-dim">{groups.length}</span> tickers
            </>
          )}
        </p>

        <div role="group" aria-label="View" className="flex gap-1">
          {(['grouped', 'flat'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={chip(view === v)}
            >
              {v === 'grouped' ? 'By ticker' : 'All contracts'}
            </button>
          ))}
        </div>

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
      ) : view === 'flat' ? (
        <section className="panel">
          <div className="scroll-term max-h-[70vh] overflow-auto">
            <ContractTable rows={filtered} head={head} cell={cell} showTicker />
          </div>
        </section>
      ) : (
        <GroupedTable groups={groups} head={head} cell={cell} />
      )}
    </div>
  );
}

// --- summary bar --------------------------------------------------------------

function SummaryBar({
  totals,
  top,
  count,
}: {
  totals: { callPremium: number; putPremium: number; total: number };
  top: { symbol: string; callPremium: number; putPremium: number; total: number }[];
  count: number;
}) {
  if (count === 0) return null;
  const { callPremium, putPremium, total } = totals;
  const callPct = total > 0 ? Math.round((callPremium / total) * 100) : 0;

  return (
    <section className="panel px-3.5 py-3" aria-label="Today's option money">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="label-xs">Call money vs put money (shown)</h2>
            <span className="text-2xs text-term-faint">{callPct}% calls</span>
          </div>
          <div className="mt-2">
            <SplitBar call={callPremium} put={putPremium} height="h-2.5" />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums">
            <span className="font-bold text-bull">{formatUsd(callPremium)} calls</span>
            <span className="font-bold text-bear">{formatUsd(putPremium)} puts</span>
          </div>
          {/* The one line that stops the bar above from being read as a signal. */}
          <p className="mt-2 text-2xs leading-relaxed text-term-dim">
            We can&rsquo;t see if these were bought or sold. Big put volume can be
            hedging or selling, not just bearish bets.
          </p>
        </div>

        <div>
          <h2 className="label-xs">Top tickers by money</h2>
          <ul className="mt-2 space-y-1.5">
            {top.map((t) => (
              <li key={t.symbol} className="flex items-center gap-2.5 text-xs">
                <span className="w-14 shrink-0 font-bold text-term-text">
                  <TickerLink symbol={t.symbol} />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-term-dim">
                  {formatUsd(t.total)}
                </span>
                <span className="min-w-0 flex-1">
                  <SplitBar call={t.callPremium} put={t.putPremium} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// --- grouped table ------------------------------------------------------------

function GroupedTable({
  groups,
  head,
  cell,
}: {
  groups: ReturnType<typeof groupByTicker>;
  head: string;
  cell: string;
}) {
  // The busiest ticker starts open so the page is not a wall of closed rows;
  // everything else is collapsed until asked for.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    groups.length > 0 ? { [groups[0].symbol]: true } : {},
  );

  const toggle = (symbol: string) =>
    setOpen((prev) => ({ ...prev, [symbol]: !prev[symbol] }));

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const isOpen = open[g.symbol] ?? false;
        const callPct = g.totalPremium > 0 ? Math.round((g.callPremium / g.totalPremium) * 100) : 0;
        return (
          <section key={g.symbol} className="panel overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(g.symbol)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-term-raised/50"
            >
              <span
                className={`shrink-0 text-term-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                aria-hidden
              >
                ▸
              </span>
              <span className="w-16 shrink-0 text-sm font-bold text-term-text">
                {g.symbol}
              </span>
              <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-term-dim sm:block">
                {formatUsd(g.totalPremium)}
              </span>
              <span className="min-w-0 flex-1">
                <SplitBar call={g.callPremium} put={g.putPremium} />
              </span>
              <span className="hidden shrink-0 gap-2 text-2xs tabular-nums text-term-faint md:flex">
                <span className="text-bull">{formatUsd(g.callPremium)} C</span>
                <span className="text-bear">{formatUsd(g.putPremium)} P</span>
              </span>
              <span className="w-20 shrink-0 text-right text-2xs text-term-faint">
                {g.strikeCount} {g.strikeCount === 1 ? 'strike' : 'strikes'}
                <span className="hidden lg:inline"> · {callPct}% C</span>
              </span>
            </button>

            {isOpen && (
              <div className="scroll-term max-h-[60vh] overflow-auto border-t border-term-line">
                <ContractTable rows={g.rows} head={head} cell={cell} showTicker={false} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// --- shared contract table ----------------------------------------------------

function ContractTable({
  rows,
  head,
  cell,
  showTicker,
}: {
  rows: FlowRow[];
  head: string;
  cell: string;
  showTicker: boolean;
}) {
  return (
    <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
      <caption className="sr-only">
        Contracts where the most option money moved, biggest first.
      </caption>
      <thead>
        <tr>
          {showTicker && <th scope="col" className={`${head} text-left`}>Ticker</th>}
          <th scope="col" className={head}>Expiry</th>
          <th scope="col" className={head}>Strike</th>
          <th scope="col" className={head}>Type</th>
          <th scope="col" className={head}>Premium</th>
          <th scope="col" className={head}>Volume</th>
          <th scope="col" className={head}>Open int.</th>
          <th scope="col" className={head}>Vol/OI</th>
          <th scope="col" className={head}>Score</th>
          <th scope="col" className={`${head} text-left`}>Flag</th>
          <th scope="col" className={`${head} text-left`}>What happened</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.symbol}-${r.expiration}-${r.strike}-${r.type}`}>
            {showTicker && (
              <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                <TickerLink symbol={r.symbol} />
              </th>
            )}
            <td className={`${cell} text-term-dim`}>{r.expiryLabel}</td>
            <td className={`${cell} text-term-text`}>{formatStrike(r.strike)}</td>
            <td
              className={`${cell} font-bold ${r.type === 'call' ? 'text-bull' : 'text-bear'}`}
            >
              {r.type === 'call' ? 'CALL' : 'PUT'}
            </td>
            <td className={`${cell} font-bold text-term-text`}>
              {r.premium === null ? '—' : formatUsd(r.premium)}
            </td>
            <td className={`${cell} text-term-dim`}>{formatContracts(r.volume)}</td>
            <td className={`${cell} text-term-dim`}>{formatContracts(r.openInterest)}</td>
            <td className={`${cell} text-term-dim`}>{ratioLabel(r.volumeToOi)}</td>
            <td className={`${cell} font-bold text-term-text`}>{r.unusualScore}</td>
            <td className={`${cell} text-left`}>
              <FlagBadge flag={r.flag} />
            </td>
            <td className={`${cell} max-w-[26rem] text-left text-2xs text-term-dim`}>
              {r.note}
              {r.multiLegNote && (
                <span className="mt-0.5 block text-term-faint">{r.multiLegNote}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
