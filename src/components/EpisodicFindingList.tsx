'use client';

import { useState } from 'react';
import { EpisodicChart } from '@/components/EpisodicChart';
import type { EpisodicFinding } from '@/lib/episodic/types';
import { formatPrice, formatUsd } from '@/lib/format';

/**
 * A lean, controls-free list of findings with an expandable chart per row.
 *
 * Used for the base-trend filter's rejects — the reader clicks a name to see
 * whether its base really was a rising channel rather than a flat one. Kept
 * separate from the main board (which carries the threshold sliders and the
 * funnel) because this list is just "here are the ones the filter removed, look
 * for yourself"; it neither sorts by nor re-thresholds anything.
 */
export function EpisodicFindingList({ findings }: { findings: EpisodicFinding[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (findings.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-2xs tabular-nums">
        <thead>
          <tr className="border-b border-term-line text-left text-term-faint">
            <th className="px-2 py-1.5 font-bold tracking-[0.04em]">Ticker</th>
            <th className="px-2 py-1.5 font-bold tracking-[0.04em]">Gap date</th>
            <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Gap %</th>
            <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Vol ×</th>
            <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">$ vol</th>
            <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Base %</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => {
            const key = `${f.symbol}:${f.gapDate}`;
            const isOpen = open === key;
            return (
              <FindingRows
                key={key}
                finding={f}
                isOpen={isOpen}
                onToggle={() => setOpen(isOpen ? null : key)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FindingRows({
  finding: f,
  isOpen,
  onToggle,
}: {
  finding: EpisodicFinding;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-term-line/60 text-term-dim hover:bg-term-line/20"
      >
        <td className="px-2 py-1.5 font-bold text-term-text">
          {f.symbol}
          <span className="ml-1 text-term-line">{isOpen ? '▾' : '▸'}</span>
        </td>
        <td className="px-2 py-1.5">{f.gapDate}</td>
        <td className="px-2 py-1.5 text-right text-pos">
          +{(f.gapPct * 100).toFixed(1)}%
        </td>
        <td className="px-2 py-1.5 text-right">{f.volumeRatio.toFixed(1)}×</td>
        <td className="px-2 py-1.5 text-right">{formatUsd(f.dollarVolume)}</td>
        <td className="px-2 py-1.5 text-right">{(f.baseRangePct * 100).toFixed(1)}%</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} className="border-b border-term-line bg-term-line/10 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xs text-term-faint">
              <span className="font-bold text-term-text">{f.symbol}</span>
              {f.name && <span>{f.name}</span>}
              <span>
                current {formatPrice(f.currentPrice)} · gap-day close {formatPrice(f.gapClose)}
              </span>
            </div>
            <EpisodicChart
              bars={f.bars}
              gapDate={f.gapDate}
              midpoint={f.pause.midpoint}
              tightRangeHigh={f.pause.tightRangeHigh}
            />
          </td>
        </tr>
      )}
    </>
  );
}
