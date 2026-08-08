'use client';

import { useState } from 'react';
import { StarButton } from './StarButton';
import { formatPrice } from '@/lib/format';
import { strengthDots, type RankedTicker } from '@/lib/groups/ranking';

/**
 * The full ranked table, with copy and CSV export.
 *
 * Client-side because the clipboard and download both need the browser. The
 * CSV and list text are built on the server and passed down as strings, so
 * this component holds no ranking logic of its own — the exported file always
 * matches exactly what the page rendered.
 */

function Dots({ bullish, total }: { bullish: number; total: number }) {
  const filled = strengthDots(bullish, total);
  const on = filled === 3 ? 'bg-bull' : filled === 2 ? 'bg-flip' : 'bg-bear';
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Strength ${filled} of 3`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= filled ? on : 'bg-term-line'}`}
        />
      ))}
    </span>
  );
}

interface Props {
  ranked: RankedTicker[];
  csv: string;
  list: string;
  asOfDate: string;
}

export function StrengthTable({ ranked, csv, list, asOfDate }: Props) {
  const [copied, setCopied] = useState<'list' | 'csv' | null>(null);

  const copy = async (text: string, which: 'list' | 'csv') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard is blocked in some contexts (insecure origins, permissions).
      // Fall back to selecting nothing rather than throwing at the user.
      setCopied(null);
    }
  };

  const download = () => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gammadesk-strength-${asOfDate || 'latest'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const button =
    'border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text';

  return (
    <section aria-label="Full ranking" className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          All {ranked.length}, ranked
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => copy(list, 'list')} className={button}>
            {copied === 'list' ? 'Copied' : 'Copy list'}
          </button>
          <button type="button" onClick={() => copy(csv, 'csv')} className={button}>
            {copied === 'csv' ? 'Copied' : 'Copy CSV'}
          </button>
          <button type="button" onClick={download} className={button}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="scroll-term max-h-[70vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
          <caption className="sr-only">
            Every tracked ticker ranked by composite strength score.
          </caption>
          <thead>
            <tr>
              {['Rank', 'Ticker', 'Score', 'Strength', 'Signals', 'Price', 'Chg', '20d', 'Groups'].map(
                (h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim ${
                      i === 1 || i === 3 || i === 8 ? 'text-left' : ''
                    }`}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => {
              const strong = r.score >= 70;
              const weak = r.score <= 35;
              return (
                <tr key={r.symbol} className="border-t border-term-line/60">
                  <td className="border-b border-term-line/60 px-2.5 py-1.5 text-term-faint">
                    {r.rank}
                  </td>
                  <th
                    scope="row"
                    className="border-b border-term-line/60 px-2.5 py-1.5 text-left font-bold text-term-text"
                  >
                    <span className="flex items-center gap-1">
                      <StarButton symbol={r.symbol} size="sm" />
                      {r.symbol}
                    </span>
                  </th>
                  <td
                    className={`border-b border-term-line/60 px-2.5 py-1.5 font-bold ${
                      strong ? 'text-bull' : weak ? 'text-bear' : 'text-term-dim'
                    }`}
                  >
                    {r.score}
                  </td>
                  <td className="border-b border-term-line/60 px-2.5 py-1.5 text-left">
                    <Dots bullish={r.bullish} total={r.total} />
                  </td>
                  <td className="border-b border-term-line/60 px-2.5 py-1.5 text-term-dim">
                    {r.bullish}/{r.total}
                  </td>
                  <td className="border-b border-term-line/60 px-2.5 py-1.5 text-term-dim">
                    {formatPrice(r.price)}
                  </td>
                  <td
                    className={`border-b border-term-line/60 px-2.5 py-1.5 ${
                      r.changePct >= 0 ? 'text-bull' : 'text-bear'
                    }`}
                  >
                    {r.changePct >= 0 ? '+' : ''}
                    {(r.changePct * 100).toFixed(2)}%
                  </td>
                  <td
                    className={`border-b border-term-line/60 px-2.5 py-1.5 ${
                      r.momentum20 >= 0 ? 'text-bull' : 'text-bear'
                    }`}
                  >
                    {r.momentum20 >= 0 ? '+' : ''}
                    {(r.momentum20 * 100).toFixed(1)}%
                  </td>
                  <td className="border-b border-term-line/60 px-2.5 py-1.5 text-left text-2xs text-term-faint">
                    {r.groups.join(' · ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
