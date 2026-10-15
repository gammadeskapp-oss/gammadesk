'use client';

import { type ComponentProps, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Daily20Board } from './Daily20Board';
import { ScannerBoard } from './ScannerBoard';
import { Playbook, type MarketCondition } from './Playbook';
import { WhatChangedToday } from './WhatChangedToday';
import type { Daily20 } from '@/lib/scanner/daily20';
import type { Playbook as PlaybookData } from '@/lib/scanner/playbook';
import type { ChangeLine } from '@/lib/scanner/daily20Diff';
import type { SectorConfirm } from '@/lib/scanner/sectorConfirmation';
import type { JournalNow } from '@/lib/scanner/journal';

/**
 * The scanner's three views: Today's Playbook (the default morning landing), the
 * Daily 20, and the full scored index.
 *
 * The Playbook is the curated shortlist — the five best-aligned research
 * candidates, the five to avoid or watch, and the reader's own saved names —
 * the view most readers want first. The Daily 20 is the ten leaders and ten
 * laggards behind it, with every component shown; the full scanner is every
 * scored name with all eight filters, for power users. Both are one toggle away
 * and the choice is mirrored into the URL so a shared link survives a refresh,
 * with no server round-trip (the force-dynamic page would otherwise re-run).
 */

type View = 'playbook' | 'daily20' | 'full';

function viewFromParam(v: string | null): View {
  if (v === 'full') return 'full';
  if (v === 'daily20') return 'daily20';
  return 'playbook';
}

export function ScannerViewSwitch({
  playbook,
  condition,
  changes,
  daily20,
  sectorConfirmations,
  journalNow,
  board,
}: {
  playbook: PlaybookData;
  condition: MarketCondition;
  changes: ChangeLine[];
  daily20: Daily20;
  sectorConfirmations: Record<string, SectorConfirm>;
  journalNow: Record<string, JournalNow>;
  board: ComponentProps<typeof ScannerBoard>;
}) {
  const initial = useSearchParams();
  const [view, setView] = useState<View>(() => viewFromParam(initial.get('view')));

  useEffect(() => {
    const merged = new URLSearchParams(window.location.search);
    // Playbook is the default, so it carries no query param.
    if (view === 'playbook') merged.delete('view');
    else merged.set('view', view);
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

  const blurb: Record<View, string> = {
    playbook: 'Best-aligned research candidates, names to avoid, and your watchlist.',
    daily20: '10 leaders + 10 laggards, quality-gated then ranked.',
    full: 'Every scored name, with the eight filters.',
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Scanner view" className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={view === 'playbook'} onClick={() => setView('playbook')} className={chip(view === 'playbook')}>
          Today&rsquo;s Playbook
        </button>
        <button type="button" aria-pressed={view === 'daily20'} onClick={() => setView('daily20')} className={chip(view === 'daily20')}>
          Daily 20
        </button>
        <button type="button" aria-pressed={view === 'full'} onClick={() => setView('full')} className={chip(view === 'full')}>
          Full scanner
        </button>
        <span className="text-2xs text-term-faint">{blurb[view]}</span>
      </div>

      {view === 'playbook' ? (
        <Playbook playbook={playbook} condition={condition} changes={changes} journalNow={journalNow} />
      ) : view === 'daily20' ? (
        <>
          <WhatChangedToday changes={changes} />
          <Daily20Board daily20={daily20} sectorConfirmations={sectorConfirmations} journalNow={journalNow} />
        </>
      ) : (
        <ScannerBoard {...board} />
      )}
    </div>
  );
}
