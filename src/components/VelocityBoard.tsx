'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FacetChips } from '@/components/FacetChips';
import { InfoTip } from '@/components/InfoTip';
import { TickerLink } from '@/components/TickerLink';
import { formatStrike, formatUsd } from '@/lib/format';
import { facetsFor } from '@/lib/rs/rank';
import type { Gics } from '@/lib/rs/universe';
import type { RollOffReason, VelocityRow, VelocityTag } from '@/lib/velocity/types';

/**
 * The interactive half of /velocity: the search box, the group filter and both
 * tables.
 *
 * Built to the same pattern as /strength rather than a new one. The server
 * hands down finished rows, the filtering happens here, and control state is
 * mirrored into the address bar with `history.replaceState` — shareable and
 * refresh-proof, but touching nothing except the URL. That matters on this
 * route in particular: it is force-dynamic, so a router navigation per
 * keystroke would re-read storage every time.
 *
 * As a client component it still server-renders on first load, so the HTML
 * contains the full table rather than an empty shell.
 */

/** What each row's symbol is, and what it can be filtered by. */
export interface SymbolMeta {
  symbol: string;
  /** Company name, for searching. Falls back to the symbol. */
  name: string;
  sector: Gics | null;
}

const TAG: Record<VelocityTag, string> = {
  GREW: 'text-bull border-bull/40',
  SHRANK: 'text-bear border-bear/40',
  NEW: 'text-flip border-flip/40',
};

/** Plain-language reason a row is not repositioning. */
const ROLL_OFF: Record<RollOffReason, string> = {
  expired: 'Expired — contract is gone',
  'left-window': 'No longer tracked',
  'entered-window': 'Newly tracked',
};

const head =
  'sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';
const cell = 'border-b border-term-line/60 px-2.5 py-1.5';

/**
 * Shared by both tables. The rolled-off one swaps the Tag column for a reason,
 * because GREW/SHRANK is exactly the reading those rows should not invite.
 */
function VelocityTable({
  rows,
  caption,
  reasons = false,
}: {
  rows: VelocityRow[];
  caption: string;
  reasons?: boolean;
}) {
  return (
    <div className="scroll-term max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} text-left`}>Ticker</th>
            <th scope="col" className={head}>Expiry</th>
            <th scope="col" className={head}>Strike</th>
            <th scope="col" className={head}>vs spot</th>
            <th scope="col" className={head}>Gamma was</th>
            <th scope="col" className={head}>Gamma now</th>
            <th scope="col" className={head}>Change</th>
            <th scope="col" className={head}>%</th>
            <th scope="col" className={`${head} text-left`}>
              {reasons ? 'Why' : 'Tag'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.symbol}-${r.expiration}-${r.strike}`}>
              <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                <TickerLink symbol={r.symbol} />
              </th>
              <td className={`${cell} text-term-dim`}>{r.expiryLabel}</td>
              <td className={`${cell} text-term-text`}>{formatStrike(r.strike)}</td>
              <td
                className={`${cell} ${
                  Math.abs(r.distancePct) < 1 ? 'text-flip' : 'text-term-faint'
                }`}
              >
                {r.distancePct >= 0 ? '+' : ''}
                {r.distancePct.toFixed(1)}%
              </td>
              <td className={`${cell} ${r.was >= 0 ? 'text-pos' : 'text-neg'}`}>
                {r.was === 0 ? '—' : formatUsd(r.was)}
              </td>
              <td className={`${cell} ${r.now >= 0 ? 'text-pos' : 'text-neg'}`}>
                {r.now === 0 ? '—' : formatUsd(r.now)}
              </td>
              <td
                className={`${cell} font-bold ${
                  reasons
                    ? 'text-term-faint'
                    : r.change >= 0
                      ? 'text-bull'
                      : 'text-bear'
                }`}
              >
                {r.change >= 0 ? '+' : '−'}
                {formatUsd(Math.abs(r.change))}
              </td>
              <td className={`${cell} text-term-dim`}>
                {r.changePct === null
                  ? '—'
                  : `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(0)}%`}
              </td>
              <td className={`${cell} text-left`}>
                {reasons ? (
                  <span className="whitespace-nowrap border border-term-line px-1.5 py-0.5 text-2xs tracking-[0.08em] text-term-faint">
                    {r.rollOff ? ROLL_OFF[r.rollOff] : '—'}
                  </span>
                ) : (
                  <span
                    className={`border px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] ${TAG[r.tag]}`}
                  >
                    {r.tag}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VelocityBoard({
  rows,
  rolledOff,
  rolledOffTotal,
  expiredTotal,
  meta,
  previousDate,
  currentDate,
}: {
  rows: VelocityRow[];
  rolledOff: VelocityRow[];
  rolledOffTotal: number;
  expiredTotal: number;
  /** Name and sector per symbol, for searching and for the group filter. */
  meta: SymbolMeta[];
  previousDate: string;
  currentDate: string;
}) {
  const initial = useSearchParams();

  const [query, setQuery] = useState(() => initial.get('ticker') ?? '');
  const [facetId, setFacetId] = useState(() => initial.get('group') ?? 'all');

  const bySymbol = useMemo(() => {
    const map = new Map<string, SymbolMeta>();
    for (const m of meta) map.set(m.symbol, m);
    return map;
  }, [meta]);

  /*
   * The same filter options /strength offers, from the same builder. Built
   * from the symbols actually on this page, so a group with nothing here is
   * not offered — a filter that can only ever return nothing is worse than no
   * filter.
   */
  const facets = useMemo(() => facetsFor(meta), [meta]);
  const active = facets.find((f) => f.id === facetId) ?? facets[0];

  const facetSymbols = useMemo(
    () => (active?.symbols === null || !active ? null : new Set(active.symbols)),
    [active],
  );

  /**
   * Symbol or company name, matched case-insensitively on any part.
   *
   * Both, because a reader who knows the company does not always know its
   * ticker — "micro" should find MU and MSFT rather than nothing.
   */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (symbol: string) => {
      if (facetSymbols && !facetSymbols.has(symbol)) return false;
      if (!needle) return true;
      if (symbol.toLowerCase().includes(needle)) return true;
      const name = bySymbol.get(symbol)?.name;
      return name ? name.toLowerCase().includes(needle) : false;
    };
  }, [query, facetSymbols, bySymbol]);

  /*
   * Filtering only ever removes rows, never reorders them, so the sort the
   * server applied — largest absolute dollar move first — survives untouched.
   */
  const visibleRows = useMemo(() => rows.filter((r) => matches(r.symbol)), [rows, matches]);
  const visibleRolledOff = useMemo(
    () => rolledOff.filter((r) => matches(r.symbol)),
    [rolledOff, matches],
  );

  // Mirror to the address bar. No navigation, so no server round-trip.
  useEffect(() => {
    const merged = new URLSearchParams(window.location.search);
    const write = (key: string, value: string | null) => {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    };
    write('ticker', query.trim() === '' ? null : query.trim());
    write('group', facetId === 'all' ? null : facetId);

    const search = merged.toString();
    window.history.replaceState(
      null,
      '',
      search ? `${window.location.pathname}?${search}` : window.location.pathname,
    );
  }, [query, facetId]);

  const filtering = query.trim() !== '' || facetId !== 'all';

  return (
    <>
      <div className="panel space-y-3 px-3.5 py-3">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div>
            <label htmlFor="velocity-ticker" className="label-xs block">
              <span className="inline-flex items-center gap-1.5">
                Search
                <InfoTip for="velocitySearch" />
              </span>
            </label>
            <input
              id="velocity-ticker"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="TICKER OR COMPANY — NVDA, APPLE"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full border border-term-edge bg-term-panel px-3 py-1.5 text-xs tracking-[0.12em] text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none focus:ring-1 focus:ring-pos/40 sm:w-64"
            />
          </div>

          {filtering && (
            <p className="text-2xs text-term-faint">
              {visibleRows.length} of {rows.length} row
              {rows.length === 1 ? '' : 's'} shown
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setFacetId('all');
                }}
                className="ml-2 underline decoration-dotted transition-colors hover:text-term-text"
              >
                clear
              </button>
            </p>
          )}
        </div>

        <div>
          <span className="label-xs block">Group or sector</span>
          <FacetChips facets={facets} activeId={facetId} onChange={setFacetId} />
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          {filtering ? (
            <>
              <p className="text-term-text">No tickers match that search.</p>
              <p className="mx-auto mt-2 max-w-xl leading-relaxed">
                Nothing on this page matches
                {query.trim() !== '' && (
                  <>
                    {' '}
                    &ldquo;<span className="text-term-text">{query.trim()}</span>&rdquo;
                  </>
                )}
                {query.trim() !== '' && active && active.id !== 'all' && ' in '}
                {active && active.id !== 'all' && (
                  <span className="text-term-text">{active.label}</span>
                )}
                . Only symbols with a stored chain on both days appear here.
              </p>
            </>
          ) : (
            <>
              <p className="text-term-text">No material repositioning.</p>
              <p className="mx-auto mt-2 max-w-xl leading-relaxed">
                No live strike moved more than $2M in dollar gamma between{' '}
                {previousDate} and {currentDate}. A quiet book is an ordinary
                result.
                {rolledOffTotal > 0 && (
                  <>
                    {' '}
                    {rolledOffTotal} row{rolledOffTotal === 1 ? '' : 's'} changed
                    only because the contracts rolled off; those are below.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      ) : (
        <section className="panel">
          <VelocityTable
            rows={visibleRows}
            caption="Largest day-over-day changes in per-strike dollar gamma at live expirations."
          />
        </section>
      )}

      {/*
        Collapsed, and deliberately not merged into the list above. These rows
        carry the largest numbers on the page and none of them are positioning
        — showing them inline taught the opposite of what the page is for.
      */}
      {visibleRolledOff.length > 0 && (
        <details className="panel group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden
              className="text-flip transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            <span className="font-bold uppercase tracking-[0.14em] text-flip">
              Expired &amp; rolled off
            </span>
            <span className="text-term-faint">
              {/* Counts follow the filter, so the heading cannot claim more
                  rows than the table under it holds. */}
              {visibleRolledOff.length} row
              {visibleRolledOff.length === 1 ? '' : 's'}
              {!filtering && rolledOffTotal !== visibleRolledOff.length && (
                <> of {rolledOffTotal}</>
              )}
              {!filtering && expiredTotal > 0 && ` · ${expiredTotal} expired`} — not
              repositioning
            </span>
          </summary>

          <div className="border-t border-term-line px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
            <p>
              <span className="text-term-dim">Nobody closed these positions. </span>
              A strike can only be compared when its expiry was tracked on both
              days. When it was not, the missing day counts as zero and the row
              shows a huge change that never happened.
            </p>
            <ul className="mt-2 space-y-1">
              <li>
                <span className="text-term-dim">Expired</span> — the expiry date
                has passed, so the contract no longer exists. Its gamma did not
                shrink; it stopped being a thing.
              </li>
              <li>
                <span className="text-term-dim">No longer tracked</span> — still
                live, but it fell outside the nearest five expirations we store.
              </li>
              <li>
                <span className="text-term-dim">Newly tracked</span> — just came
                inside those five, with open interest already built up on it. New
                to this page, not new to the market.
              </li>
            </ul>
          </div>

          <VelocityTable
            rows={visibleRolledOff}
            caption="Strikes whose gamma changed because the contract rolled off, not because anyone repositioned."
            reasons
          />
        </details>
      )}
    </>
  );
}
