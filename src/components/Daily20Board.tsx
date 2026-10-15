'use client';

import { useState } from 'react';
import { TickerLink } from './TickerLink';
import { LeaderCard } from './LeaderCard';
import {
  COMPONENT_LABEL,
  DIRECTION_COMPONENT_KEYS,
  type Direction,
} from '@/lib/scanner/directionScore';
import { SETUP_LABEL, type Daily20, type Daily20Entry } from '@/lib/scanner/daily20';
import type { SectorConfirm } from '@/lib/scanner/sectorConfirmation';
import { JournalPanel } from './JournalControls';
import type { JournalNow } from '@/lib/scanner/journal';

/**
 * The Daily 20 — ten bullish leaders beside ten bearish laggards, each with its
 * full component breakdown and its two honest labels.
 *
 * Deliberately not a buy list. Every entry shows its leadership label (how
 * strong it is) and, separately, its setup label (whether the timing is any
 * good right now), and every component of the score is printed beside the
 * total. A high score with a "Watch for confirmation" setup reads as exactly
 * that — strong, but not a green light — which is the whole point of the two
 * axes. Nothing here says buy or sell.
 */

/** Colour for the combined display label, red surfaced as readily as green. */
function labelTone(display: string): string {
  if (display === 'Actionable leader') return 'text-bull';
  if (display === 'Actionable laggard') return 'text-bear';
  if (display.includes('extended') || display.includes('stretched')) return 'text-flip';
  return 'text-term-dim';
}

function ComponentGrid({ entry }: { entry: Daily20Entry }) {
  const labels = COMPONENT_LABEL[entry.direction];
  return (
    <div className="mt-1.5 grid grid-cols-4 gap-x-3 gap-y-1 sm:grid-cols-7">
      {DIRECTION_COMPONENT_KEYS.map((key) => {
        const v = entry.score.components[key];
        return (
          <div key={key} className="min-w-0">
            <div className="truncate text-[10px] uppercase tracking-[0.08em] text-term-faint">
              {labels[key]}
            </div>
            <div className={`text-xs tabular-nums ${v === null ? 'text-term-faint' : 'text-term-text'}`}>
              {v === null ? '—' : Math.round(v)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Colour for the lifecycle headline badge. */
function lifecycleTone(entry: Daily20Entry): string {
  const s = entry.lifecycle.state;
  if (s === 'breakout' || s === 'confirmed-leader') return 'text-bull';
  if (s === 'breakdown' || s === 'confirmed-laggard') return 'text-bear';
  if (s === 'extended' || s === 'stretched' || s === 'damaged' || s === 'failed') return 'text-flip';
  return 'text-term-dim';
}

/** Tone for the sector confirm/conflict chip, red as readily as green. */
function sectorTone(verdict: SectorConfirm['verdict']): string {
  if (verdict === 'confirm') return 'text-bull';
  if (verdict === 'conflict') return 'text-bear';
  return 'text-term-dim';
}

function EntryRow({ entry, sector }: { entry: Daily20Entry; sector?: SectorConfirm }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-term-line/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-3 py-2.5 text-left transition-colors hover:bg-term-raised/40"
      >
        <div className="flex items-baseline gap-2.5">
          <span className="w-6 shrink-0 text-right text-2xs tabular-nums text-term-faint">{entry.rank}</span>
          <span className="w-16 shrink-0 font-bold text-term-text">
            <TickerLink symbol={entry.symbol} />
          </span>
          <span className="shrink-0 text-lg font-bold tabular-nums text-term-text">
            {Math.round(entry.score.total)}
          </span>
          <span className="min-w-0 flex-1 text-right">
            {/* Lifecycle is the headline (step 10); the display label sits under it. */}
            <span className={`text-xs font-bold ${lifecycleTone(entry)}`}>{entry.lifecycle.label}</span>
          </span>
          <span className="shrink-0 text-term-faint" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-8 text-2xs text-term-dim">
          <span className={labelTone(entry.display)}>{entry.display}</span>
          <span>·</span>
          <span className="text-term-faint">{entry.leadership}</span>
          <span>·</span>
          <span>{SETUP_LABEL[entry.setup]}</span>
          {entry.gate.observations.earningsSoon && <span className="text-flip">· earnings soon</span>}
        </div>
        <div className="pl-8">
          <ComponentGrid entry={entry} />
        </div>
        {sector && (
          <div className="mt-1 pl-8 text-2xs">
            <span className={sectorTone(sector.verdict)}>
              {sector.verdict === 'confirm' ? 'Sector confirms' : sector.verdict === 'conflict' ? 'Sector conflicts' : 'Sector mixed'}
            </span>
            <span className="text-term-faint">
              {' '}· {sector.sectorName} #{sector.sectorRank}/{sector.of}
              {sector.peers > 0 ? ` · ${sector.peers} peer${sector.peers === 1 ? '' : 's'}` : ''}
              {sector.pctAbove50 !== null ? ` · ${sector.pctAbove50}% >50d` : ''}
            </span>
          </div>
        )}
      </button>
      {open && <LeaderCard entry={entry} sector={sector} />}
    </li>
  );
}

function SideColumn({
  title,
  direction,
  entries,
  eligible,
  sectorConfirmations,
}: {
  title: string;
  direction: Direction;
  entries: Daily20Entry[];
  eligible: number;
  sectorConfirmations: Record<string, SectorConfirm>;
}) {
  const accent = direction === 'bullish' ? 'text-bull' : 'text-bear';
  return (
    <section className="panel">
      <div className="flex items-baseline justify-between border-b border-term-line px-3 py-2">
        <h2 className={`text-2xs font-bold uppercase tracking-[0.16em] ${accent}`}>{title}</h2>
        <span className="text-2xs text-term-faint">
          {entries.length} of {eligible} eligible
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-term-dim">
          No names cleared the {direction === 'bullish' ? 'leader' : 'laggard'} gate this run.
        </p>
      ) : (
        <ul>
          {entries.map((e) => (
            <EntryRow key={e.symbol} entry={e} sector={sectorConfirmations[e.symbol]} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function Daily20Board({
  daily20,
  sectorConfirmations = {},
  journalNow = {},
}: {
  daily20: Daily20;
  sectorConfirmations?: Record<string, SectorConfirm>;
  journalNow?: Record<string, JournalNow>;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <SideColumn
          title="Bullish leaders"
          direction="bullish"
          entries={daily20.bullish}
          eligible={daily20.eligible.bullish}
          sectorConfirmations={sectorConfirmations}
        />
        <SideColumn
          title="Bearish laggards"
          direction="bearish"
          entries={daily20.bearish}
          eligible={daily20.eligible.bearish}
          sectorConfirmations={sectorConfirmations}
        />
      </div>
      <JournalPanel nowBySymbol={journalNow} />

      <p className="px-1 text-2xs leading-relaxed text-term-faint">
        Gated first, then ranked. Each name shows its strength label and, separately, its setup —
        a high score is not a signal to act. Every component of the score is printed beside the
        total; a dash means that reading was not available and dropped out of the blend. Nothing
        here is a suggestion to buy or sell.
      </p>
    </div>
  );
}
