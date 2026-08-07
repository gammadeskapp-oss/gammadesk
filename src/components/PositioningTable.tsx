'use client';

import { useMemo, type CSSProperties } from 'react';
import { formatContracts, formatPrice, formatStrike } from '@/lib/format';
import { METRICS } from '@/lib/metrics';
import type { MetricKey, PositioningData } from '@/lib/types';

const POSITIVE_RGB = '34, 211, 238'; // cyan
const NEGATIVE_RGB = '255, 63, 180'; // magenta

/**
 * Map a value to a heatmap cell style.
 *
 * Intensity is scaled against the largest absolute value in the same group of
 * cells, then run through a gamma curve so that mid-sized values stay visible
 * instead of being washed out by one dominant strike.
 */
function heat(value: number, max: number): CSSProperties {
  if (!Number.isFinite(value) || value === 0 || max <= 0) {
    return { color: '#3d4757' };
  }

  const ratio = Math.min(1, Math.abs(value) / max);
  const alpha = 0.04 + 0.46 * Math.pow(ratio, 0.55);
  const rgb = value > 0 ? POSITIVE_RGB : NEGATIVE_RGB;

  return {
    backgroundColor: `rgba(${rgb}, ${alpha.toFixed(3)})`,
    color: `rgba(233, 243, 252, ${(0.55 + 0.45 * ratio).toFixed(3)})`,
  };
}

interface PositioningTableProps {
  data: PositioningData;
  metric: MetricKey;
}

export function PositioningTable({ data, metric }: PositioningTableProps) {
  const def = METRICS[metric];
  const { rows, expirationMeta, columnTotals, grandTotal, spot, summary } = data;

  /**
   * Two independent colour scales. The TOTAL column sums five expirations, so
   * sharing one scale with the per-expiration cells would flatten the grid.
   */
  const { cellMax, totalMax } = useMemo(() => {
    let cell = 0;
    let total = 0;
    for (const row of rows) {
      for (const c of row.cells) cell = Math.max(cell, Math.abs(def.read(c)));
      total = Math.max(total, Math.abs(def.read(row.total)));
    }
    return { cellMax: cell, totalMax: total };
  }, [rows, def]);

  /** Strike closest to spot, and closest to the gamma flip level. */
  const { spotStrike, flipStrike } = useMemo(() => {
    let nearestSpot: number | null = null;
    let nearestFlip: number | null = null;
    let spotGap = Infinity;
    let flipGap = Infinity;

    for (const row of rows) {
      const ds = Math.abs(row.strike - spot);
      if (ds < spotGap) {
        spotGap = ds;
        nearestSpot = row.strike;
      }
      if (summary.flipLevel !== null) {
        const df = Math.abs(row.strike - summary.flipLevel);
        if (df < flipGap) {
          flipGap = df;
          nearestFlip = row.strike;
        }
      }
    }
    return { spotStrike: nearestSpot, flipStrike: nearestFlip };
  }, [rows, spot, summary.flipLevel]);

  const headCell =
    'sticky top-0 z-20 border-b border-term-edge bg-term-raised px-2 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

  return (
    <div className="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-term-line px-3 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          {def.name}
        </h2>
        <p className="text-2xs text-term-faint">{def.unit}</p>
      </div>

      <div className="scroll-term max-h-[74vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
          <caption className="sr-only">
            {def.name} for {data.symbol} by strike and expiration.
          </caption>

          <thead>
            <tr>
              <th
                scope="col"
                className={`${headCell} sticky left-0 z-30 border-r border-term-edge text-left`}
              >
                Strike
              </th>
              {expirationMeta.map((exp) => (
                <th key={exp.date} scope="col" className={headCell}>
                  <div>{exp.label}</div>
                  <div className="font-normal normal-case tracking-normal text-term-faint">
                    {exp.dte}d
                  </div>
                </th>
              ))}
              <th
                scope="col"
                className={`${headCell} border-l border-term-edge text-pos`}
              >
                <div>Total</div>
                <div className="font-normal normal-case tracking-normal text-term-faint">
                  all exp
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const isSpot = row.strike === spotStrike;
              const isFlipRow = row.strike === flipStrike;
              // When spot sits on the flip, one row carries both. Keep the cyan
              // spot styling and fold the flip into its label rather than
              // silently dropping the marker — that overlap is precisely the
              // moment the flip level matters most.
              const isFlip = isFlipRow && !isSpot;

              const rowClass = isSpot
                ? 'bg-pos/[0.07]'
                : isFlip
                  ? 'bg-flip/[0.07]'
                  : '';

              const strikeBg = isSpot
                ? 'bg-[#0b2027] text-pos'
                : isFlip
                  ? 'bg-[#1e1a08] text-flip'
                  : 'bg-term-panel text-term-dim';

              const edge = isSpot
                ? 'border-y border-pos/45'
                : isFlip
                  ? 'border-y border-flip/40'
                  : 'border-b border-term-line/60';

              return (
                <tr key={row.strike} className={rowClass}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 border-r border-term-edge px-2 py-[0.3rem] text-left font-bold ${strikeBg} ${edge}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {formatStrike(row.strike)}
                      {isSpot && (
                        <span className="text-2xs font-normal text-pos/80">
                          ← {formatPrice(spot)}
                          {isFlipRow && (
                            <span className="text-flip"> · flip</span>
                          )}
                        </span>
                      )}
                      {isFlip && (
                        <span className="text-2xs font-normal text-flip/80">
                          ← flip
                        </span>
                      )}
                    </span>
                  </th>

                  {row.cells.map((cell, i) => {
                    const value = def.read(cell);
                    return (
                      <td
                        key={expirationMeta[i].date}
                        style={heat(value, cellMax)}
                        className={`px-2 py-[0.3rem] ${edge}`}
                        title={`${formatStrike(row.strike)} · ${expirationMeta[i].label}\n${def.tab}: ${def.format(value)}\nCall OI ${formatContracts(cell.callOi)} / Put OI ${formatContracts(cell.putOi)}`}
                      >
                        {def.format(value)}
                      </td>
                    );
                  })}

                  <td
                    style={heat(def.read(row.total), totalMax)}
                    className={`border-l border-term-edge px-2 py-[0.3rem] font-bold ${edge}`}
                    title={`${formatStrike(row.strike)} · all expirations\n${def.tab}: ${def.format(def.read(row.total))}\nCall OI ${formatContracts(row.total.callOi)} / Put OI ${formatContracts(row.total.putOi)}`}
                  >
                    {def.format(def.read(row.total))}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-30 border-r border-t border-term-edge bg-term-raised px-2 py-2 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim"
              >
                Total
              </th>
              {columnTotals.map((total, i) => {
                const value = def.read(total);
                return (
                  <td
                    key={expirationMeta[i].date}
                    className={`sticky bottom-0 z-20 border-t border-term-edge bg-term-raised px-2 py-2 font-bold ${
                      value >= 0 ? 'text-pos' : 'text-neg'
                    }`}
                  >
                    {def.format(value)}
                  </td>
                );
              })}
              <td
                className={`sticky bottom-0 z-20 border-l border-t border-term-edge bg-term-raised px-2 py-2 font-bold ${
                  def.read(grandTotal) >= 0 ? 'text-pos' : 'text-neg'
                }`}
              >
                {def.format(def.read(grandTotal))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
