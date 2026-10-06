'use client';

import { useState } from 'react';
import { TickerLink } from '@/components/TickerLink';
import { MacroAlignmentBadge, MACRO_ALIGNMENT_FILTERS } from './MacroAlignmentBadge';
import type { MacroAlignment } from '@/lib/redesign/mock';

/**
 * Macro on the Scanner — a "Macro alignment" column plus filters, on the
 * scanner page itself rather than a separate page.
 *
 * Wired to the real scored list: the page passes the actual top names by score,
 * each tagged against the live macro backdrop by `macroAlignmentFor`. It used to
 * render a hardcoded demonstration set (NVDA at 91, an XLU that is not even in
 * the S&P 500), which sat on the public page above a ranked list that disagreed
 * with it — so it now takes the same rows the board does and cannot drift from
 * them.
 */
export interface MacroRow {
  symbol: string;
  score: number;
  macro: MacroAlignment;
}

export function ScannerMacroPanel({ rows: allRows }: { rows: MacroRow[] }) {
  const [active, setActive] = useState<MacroAlignment | null>(null);

  /*
    Only worth showing when at least one top name carries a real macro tag.
    `aligned` is the fallback — "nothing flags it as conflicting with the
    backdrop" — so a table of all-`aligned` rows says nothing the board below it
    does not, and the panel hides itself rather than padding the page with it.
  */
  if (!allRows.some((r) => r.macro !== 'aligned')) return null;

  const rows = active ? allRows.filter((r) => r.macro === active) : allRows;

  return (
    <section className="panel border-l-2 border-l-flip/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="label-xs">Macro alignment</h2>
          <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            top names, tagged against the macro backdrop
          </span>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActive(null)}
          className={`border px-2 py-0.5 text-2xs uppercase tracking-[0.1em] transition-colors ${
            active === null ? 'border-pos/60 bg-pos/10 text-pos' : 'border-term-line text-term-faint hover:text-term-dim'
          }`}
        >
          All
        </button>
        {MACRO_ALIGNMENT_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setActive((cur) => (cur === f.key ? null : f.key))}
            aria-pressed={active === f.key}
            className={`border px-2 py-0.5 text-2xs uppercase tracking-[0.1em] transition-colors ${
              active === f.key ? 'border-pos/60 bg-pos/10 text-pos' : 'border-term-line text-term-faint hover:text-term-dim'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table with the Macro alignment column */}
      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            <th className="py-1 text-left font-normal">Symbol</th>
            <th className="py-1 text-right font-normal">Score</th>
            <th className="py-1 text-right font-normal">Macro alignment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-t border-term-line">
              <td className="py-1.5">
                <TickerLink symbol={r.symbol} className="font-bold text-term-text" />
              </td>
              <td className="py-1.5 text-right font-bold tabular-nums text-pos">{r.score}</td>
              <td className="py-1.5 text-right">
                <MacroAlignmentBadge alignment={r.macro} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-center text-2xs text-term-faint">
                No names match this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
