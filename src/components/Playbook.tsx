'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TickerLink } from './TickerLink';
import { WhatChangedToday } from './WhatChangedToday';
import type { ChangeLine } from '@/lib/scanner/daily20Diff';
import {
  ALIGNMENT_COMPONENT_KEYS,
  ALIGNMENT_COMPONENT_LABEL,
  type Playbook as PlaybookData,
  type PlaybookItem,
} from '@/lib/scanner/playbook';
import { readJournal, type JournalEntry, type JournalNow } from '@/lib/scanner/journal';

/**
 * Today's Playbook — the morning default landing view.
 *
 * Top to bottom: the market condition (reusing the engines' own wording, not
 * restating them), what changed since the last session, the five best-aligned
 * research candidates, five strong-but-mistimed avoid/watch names, and the
 * reader's own saved watchlist. Every candidate shows its Alignment and every
 * component of it, carries a watch line, and links to its Leader Card / Decision
 * page. Nothing here says buy or sell; a red caution is surfaced as readily as a
 * green one.
 */

export interface MarketCondition {
  /** Dealer-gamma regime for the index. */
  regime: 'positive' | 'negative' | null;
  /** Share of the index above its prior close, 0-100. */
  breadthPct: number | null;
  /** The breadth engine's own sentence. */
  breadthLine: string | null;
  /** The big-vs-average-stock line, when fresh. */
  spyRspLine: string | null;
  /** A plain event-risk note, e.g. "3 index names report in the next 24h". */
  eventLine: string | null;
  /** The macro-alignment read for the market, when available. */
  macroLine: string | null;
}

function regimeWording(regime: 'positive' | 'negative' | null): string {
  if (regime === 'positive')
    return 'Positive gamma — dealer hedging tends to damp the index’s moves.';
  if (regime === 'negative')
    return 'Negative gamma — dealer hedging tends to amplify the index’s moves.';
  return 'Index dealer positioning not measured today.';
}

function MarketConditionPanel({ condition }: { condition: MarketCondition }) {
  const rows: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Gamma regime', value: regimeWording(condition.regime) },
  ];
  if (condition.breadthLine) {
    rows.push({
      label: 'Breadth',
      value:
        condition.breadthPct !== null
          ? `${Math.round(condition.breadthPct)}% — ${condition.breadthLine}`
          : condition.breadthLine,
    });
  }
  if (condition.spyRspLine) rows.push({ label: 'Big vs average', value: condition.spyRspLine });
  if (condition.macroLine) rows.push({ label: 'Macro', value: condition.macroLine });
  if (condition.eventLine)
    rows.push({ label: 'Event risk', value: condition.eventLine, tone: 'text-flip/90' });

  return (
    <section className="panel" aria-label="Market condition">
      <div className="border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">
          Market condition
        </h2>
      </div>
      <dl className="divide-y divide-term-line/60">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3.5 py-2 text-2xs">
            <dt className="w-24 shrink-0 uppercase tracking-[0.1em] text-term-faint">{r.label}</dt>
            <dd className={`min-w-0 flex-1 ${r.tone ?? 'text-term-dim'}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-term-line/60 px-3.5 py-2 text-2xs leading-relaxed text-term-faint">
        The index backdrop every name below is read against. It is context, not a score — nothing
        here is a call on direction.
      </p>
    </section>
  );
}

function AlignmentBar({ item }: { item: PlaybookItem }) {
  return (
    <div className="mt-1.5 grid grid-cols-5 gap-x-2 gap-y-1">
      {ALIGNMENT_COMPONENT_KEYS.map((key) => {
        const v = item.alignment.components[key];
        return (
          <div key={key} className="min-w-0">
            <div className="truncate text-[10px] uppercase tracking-[0.08em] text-term-faint">
              {ALIGNMENT_COMPONENT_LABEL[key]}
            </div>
            <div
              className={`text-xs tabular-nums ${v === null ? 'text-term-faint' : 'text-term-text'}`}
            >
              {v === null ? '—' : Math.round(v)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ItemRow({ item, kind }: { item: PlaybookItem; kind: 'research' | 'avoid' }) {
  const e = item.entry;
  const accent = e.direction === 'bullish' ? 'text-bull' : 'text-bear';
  return (
    <li className="border-b border-term-line/60 px-3.5 py-2.5 last:border-b-0">
      <div className="flex items-baseline gap-2.5">
        <span className="w-16 shrink-0 font-bold text-term-text">
          <TickerLink symbol={e.symbol} />
        </span>
        <span className="shrink-0 text-base font-bold tabular-nums text-term-text">
          {Math.round(item.alignment.total)}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-term-faint">align</span>
        <span className={`min-w-0 flex-1 truncate text-right text-xs font-bold ${accent}`}>
          {e.lifecycle.label}
        </span>
      </div>

      <p className="mt-1 text-2xs text-term-dim">{item.reason}</p>

      {kind === 'avoid' && item.excluded && (
        <p className="mt-0.5 text-2xs font-bold text-bear">Avoid/watch: {item.excluded}.</p>
      )}

      <AlignmentBar item={item} />

      <p className="mt-1 text-2xs text-flip/90">Watch: {item.watch}</p>

      <div className="mt-1 flex gap-3 text-2xs">
        <Link
          href={`/decision?ticker=${encodeURIComponent(e.symbol)}`}
          className="text-term-dim underline decoration-dotted hover:text-term-text"
        >
          Decision page
        </Link>
        <Link
          href="/scanner?view=daily20"
          className="text-term-faint underline decoration-dotted hover:text-term-text"
        >
          Leader card
        </Link>
      </div>
    </li>
  );
}

function ShortlistColumn({
  title,
  subtitle,
  items,
  kind,
  emptyNote,
}: {
  title: string;
  subtitle: string;
  items: PlaybookItem[];
  kind: 'research' | 'avoid';
  emptyNote: string;
}) {
  const accent = kind === 'research' ? 'text-bull' : 'text-flip';
  return (
    <section className="panel">
      <div className="border-b border-term-line px-3.5 py-2">
        <h2 className={`text-2xs font-bold uppercase tracking-[0.16em] ${accent}`}>{title}</h2>
        <p className="mt-0.5 text-2xs text-term-faint">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-3.5 py-8 text-center text-xs text-term-dim">{emptyNote}</p>
      ) : (
        <ul>
          {items.map((it) => (
            <ItemRow key={it.entry.symbol} item={it} kind={kind} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** How a saved name has aged against today's reading — the watchlist line. */
function watchlistLine(saved: JournalEntry, now: JournalNow | null): { text: string; warn: boolean } {
  if (!now) {
    return { text: 'no longer in today’s Daily 20 — re-check it yourself.', warn: false };
  }
  const from = Math.round(saved.snapshot.score);
  const to = Math.round(now.score);
  const bits: string[] = [];
  if (to > from) bits.push(`strengthened ${from} → ${to}`);
  else if (to < from) bits.push(`weakened ${from} → ${to}`);
  else bits.push(`held at ${to}`);
  if (now.lifecycleLabel && now.lifecycleLabel !== saved.snapshot.lifecycleLabel) {
    bits.push(`now ${now.lifecycleLabel.toLowerCase()}`);
  } else if (now.extended) {
    bits.push('now extended');
  }
  if (now.nearLevel) bits.push('near the relevant gamma level');
  const warn = to < from || now.extended || Boolean(now.nearLevel);
  return { text: bits.join(', ') + '.', warn };
}

function WatchlistPanel({ nowBySymbol }: { nowBySymbol: Record<string, JournalNow> }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  useEffect(() => {
    const refresh = () => setEntries(readJournal());
    refresh();
    window.addEventListener('gammadesk:journal', refresh);
    return () => window.removeEventListener('gammadesk:journal', refresh);
  }, []);

  return (
    <section className="panel" aria-label="Your watchlist">
      <div className="border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">
          Your watchlist
        </h2>
      </div>
      {entries.length === 0 ? (
        <p className="px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          Nothing saved yet. Expand a name on the Daily 20 and press &ldquo;+ Journal&rdquo; to track
          how a saved thesis ages — whether it strengthened, weakened, went extended, or has an event
          coming. Saved notes live in this browser only.
        </p>
      ) : (
        <ul className="divide-y divide-term-line/60">
          {entries.map((saved) => {
            const now = nowBySymbol[saved.symbol.toUpperCase()] ?? null;
            const line = watchlistLine(saved, now);
            return (
              <li key={saved.id} className="px-3.5 py-2 text-2xs">
                <span className="font-bold text-term-text">
                  <TickerLink symbol={saved.symbol} />
                </span>{' '}
                <span className={line.warn ? 'text-bear' : 'text-term-dim'}>{line.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Playbook({
  playbook,
  condition,
  changes,
  journalNow = {},
}: {
  playbook: PlaybookData;
  condition: MarketCondition;
  changes: ChangeLine[];
  journalNow?: Record<string, JournalNow>;
}) {
  return (
    <div className="space-y-3">
      <MarketConditionPanel condition={condition} />

      <WhatChangedToday changes={changes} />

      <div className="grid gap-3 lg:grid-cols-2">
        <ShortlistColumn
          title="Research candidates"
          subtitle={`Best-aligned ${playbook.research.length} of ${playbook.eligible} eligible — after extended, damaged and event-risk names are set aside.`}
          items={playbook.research}
          kind="research"
          emptyNote="No name cleared the gate and the hard exclusions this run. On a mistimed tape that is the honest answer."
        />
        <ShortlistColumn
          title="Avoid / watch"
          subtitle="Strong but mistimed — extended, damaged, or nearing an adverse event."
          items={playbook.avoid}
          kind="avoid"
          emptyNote="Nothing strong is currently mistimed or near an event."
        />
      </div>

      <WatchlistPanel nowBySymbol={journalNow} />

      <p className="px-1 text-2xs leading-relaxed text-term-faint">
        Ranked by Alignment — 30% leadership, 30% setup quality, 15% liquidity, 15% gamma room, 10%
        risk headroom — renormalised over the readings each name has, every component printed above.
        Extended, stretched, damaged and event-risk names are set aside from research outright, not
        down-weighted, and routed to the watch list instead. Nothing here is a suggestion to buy or
        sell.
      </p>
    </div>
  );
}
