'use client';

import { type ComponentProps, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Daily20Board } from './Daily20Board';
import { ScannerBoard } from './ScannerBoard';
import type { Daily20 } from '@/lib/scanner/daily20';
import type { SectorConfirm } from '@/lib/scanner/sectorConfirmation';
import type { JournalNow } from '@/lib/scanner/journal';

/**
 * The scanner's two views: the Daily 20 (default) and the full scored index.
 *
 * The Daily 20 is a curated ten leaders and ten laggards, quality-gated then
 * ranked — the view most readers want. The full scanner is every scored name
 * with all eight filters, for power users, one toggle away. The choice is
 * mirrored into the URL so a link to the full board survives a refresh, with no
 * server round-trip (the force-dynamic page would otherwise re-run on it).
 */

type View = 'daily20' | 'full';

export function ScannerViewSwitch({
  daily20,
  sectorConfirmations,
  journalNow,
  board,
}: {
  daily20: Daily20;
  sectorConfirmations: Record<string, SectorConfirm>;
  journalNow: Record<string, JournalNow>;
  board: ComponentProps<typeof ScannerBoard>;
}) {
  const initial = useSearchParams();
  const [view, setView] = useState<View>(() => (initial.get('view') === 'full' ? 'full' : 'daily20'));

  useEffect(() => {
    const merged = new URLSearchParams(window.location.search);
    if (view === 'full') merged.set('view', 'full');
    else merged.delete('view');
    const query = merged.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [view]);

  const chip = (active: boolean) =>
    `border px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.12em] transition-colors ${
      active
        ? 'border-pos/60 bg-pos/15 text-pos'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Scanner view" className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={view === 'daily20'} onClick={() => setView('daily20')} className={chip(view === 'daily20')}>
          Daily 20
        </button>
        <button type="button" aria-pressed={view === 'full'} onClick={() => setView('full')} className={chip(view === 'full')}>
          Full scanner
        </button>
        <span className="text-2xs text-term-faint">
          {view === 'daily20'
            ? '10 leaders + 10 laggards, quality-gated then ranked.'
            : 'Every scored name, with the eight filters.'}
        </span>
      </div>

      {view === 'daily20' ? (
        <Daily20Board daily20={daily20} sectorConfirmations={sectorConfirmations} journalNow={journalNow} />
      ) : (
        <ScannerBoard {...board} />
      )}
    </div>
  );
}
