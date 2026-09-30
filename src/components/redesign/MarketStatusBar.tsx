'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DataFreshnessBadge } from './DataFreshnessBadge';
import type { MarketStatusMock } from '@/lib/redesign/mock';

/**
 * One global sticky status bar, shared across pages.
 *
 * Replaces the per-card "market status / close message / timestamp" repetition
 * the old dashboard scattered across every tile: the answer is the same on the
 * whole page, so it is stated once, here.
 *
 * The clock is rendered only after mount so the server and hydration renders
 * agree (a `new Date()` on the server would disagree with the browser's and
 * trip a hydration mismatch on the one element that must never flicker).
 *
 * Presentational for the layout-first preview: it is handed a status object
 * rather than reading the market clock itself. Real wiring passes the live
 * `currentMarketStatus()` reading down.
 */
export function MarketStatusBar({ status }: { status: MarketStatusMock }) {
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/New_York',
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 1000 * 30);
    return () => clearInterval(id);
  }, []);

  const phaseTone =
    status.phase === 'open' ? 'text-bull' : status.phase === 'closed' ? 'text-term-faint' : 'text-flip';

  return (
    <div className="sticky top-0 z-30 border-b border-term-line bg-term-bg/95 backdrop-blur supports-[backdrop-filter]:bg-term-bg/80">
      <div className="mx-auto flex w-full max-w-[1700px] items-center gap-3 px-4 py-2 sm:px-6">
        <Link href="/" className="flex items-baseline gap-1.5 lg:hidden">
          <span aria-hidden className="text-base leading-none text-pos">γ</span>
        </Link>

        <span className={`flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] ${phaseTone}`}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          <span className="font-bold">{status.phaseLabel}</span>
        </span>

        <DataFreshnessBadge level={status.freshness} label={status.asOfLabel} />

        <span className="ml-auto flex items-center gap-2 tabular-nums text-2xs text-term-faint">
          {clock && (
            <>
              <span aria-hidden>ET</span>
              <span className="text-term-dim">{clock}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
