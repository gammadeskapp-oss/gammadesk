'use client';

import { useState } from 'react';
import { TickerLink } from '@/components/TickerLink';
import { MacroAlignmentBadge, MACRO_ALIGNMENT_FILTERS } from './MacroAlignmentBadge';
import type { MacroAlignment } from '@/lib/redesign/mock';

/**
 * Macro on the Scanner — a "Macro alignment" column plus filters, on the
 * scanner page itself rather than a separate page.
 *
 * Layout-first preview: this is a self-contained demonstration of the column
 * and the filter chips over placeholder rows. The real feature folds the
 * `macro` field and these filters into the existing sortable `ScannerBoard`.
 */
interface Row {
  symbol: string;
  score: number;
  macro: MacroAlignment;
}

const ROWS: Row[] = [
  { symbol: 'NVDA', score: 91, macro: 'conflicted' },
  { symbol: 'JPM', score: 84, macro: 'rate-sensitive' },
  { symbol: 'WMT', score: 79, macro: 'defensive' },
  { symbol: 'CAT', score: 76, macro: 'cyclical' },
  { symbol: 'XLU', score: 71, macro: 'aligned' },
  { symbol: 'MU', score: 68, macro: 'event-risk' },
];

export function ScannerMacroPanel() {
  const [active, setActive] = useState<MacroAlignment | null>(null);
  const rows = active ? ROWS.filter((r) => r.macro === active) : ROWS;

  return (
    <section className="panel border-l-2 border-l-flip/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="label-xs">Macro alignment</h2>
          <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            preview — folds into the ranked list
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
