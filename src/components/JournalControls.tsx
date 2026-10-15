'use client';

import { useEffect, useState } from 'react';
import { TickerLink } from './TickerLink';
import { researchPlan } from '@/lib/scanner/researchPlan';
import {
  addJournalEntry,
  journalId,
  journalSurfaceLine,
  readJournal,
  removeJournalEntry,
  setJournalOutcome,
  STYLE_LABEL,
  type IntendedStyle,
  type JournalEntry,
  type JournalNow,
} from '@/lib/scanner/journal';
import type { Daily20Entry } from '@/lib/scanner/daily20';

const STYLES: IntendedStyle[] = ['intraday', 'weekly', 'monthly', 'swing'];

/** The save-to-journal control inside a Leader Card. Writes to localStorage. */
export function JournalSaveButton({ entry }: { entry: Daily20Entry }) {
  const [open, setOpen] = useState(false);
  const [thesis, setThesis] = useState('');
  const [style, setStyle] = useState<IntendedStyle>('swing');
  const [saved, setSaved] = useState(false);

  const save = () => {
    const savedAt = new Date().toISOString().slice(0, 10);
    addJournalEntry({
      id: journalId(entry.symbol, savedAt),
      symbol: entry.symbol,
      direction: entry.direction,
      thesis: thesis.trim() || `${entry.lifecycle.label} — ${entry.display}.`,
      style,
      savedAt,
      snapshot: {
        score: entry.score.total,
        lifecycleLabel: entry.lifecycle.label,
        setup: entry.setup,
        invalidation: researchPlan(entry, { spot: entry.row.price }).invalidation.text,
      },
      outcome: null,
    });
    setSaved(true);
    setOpen(false);
    setThesis('');
  };

  if (saved) return <span className="text-2xs text-term-faint">Saved to journal ✓</span>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-term-line px-2 py-0.5 text-2xs uppercase tracking-[0.1em] text-term-dim hover:border-term-edge hover:text-term-text"
      >
        + Journal
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="One-sentence thesis"
        className="w-48 border border-term-edge bg-term-panel px-2 py-1 text-2xs text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none"
      />
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as IntendedStyle)}
        className="border border-term-edge bg-term-panel px-1.5 py-1 text-2xs text-term-text"
      >
        {STYLES.map((s) => (
          <option key={s} value={s}>
            {STYLE_LABEL[s]}
          </option>
        ))}
      </select>
      <button type="button" onClick={save} className="border border-pos/50 bg-pos/10 px-2 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-pos">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-2xs text-term-faint">
        Cancel
      </button>
    </div>
  );
}

/** The journal panel — saved notes, their surface line against today, outcome edit. */
export function JournalPanel({ nowBySymbol = {} }: { nowBySymbol?: Record<string, JournalNow> }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  useEffect(() => {
    const refresh = () => setEntries(readJournal());
    refresh();
    window.addEventListener('gammadesk:journal', refresh);
    return () => window.removeEventListener('gammadesk:journal', refresh);
  }, []);

  if (entries.length === 0) {
    return (
      <section className="panel px-3.5 py-3">
        <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">Your journal</h2>
        <p className="mt-2 text-2xs leading-relaxed text-term-faint">
          Empty. Expand any Daily 20 name and press &ldquo;+ Journal&rdquo; to save a one-line
          thesis, your intended style, and a dated snapshot. Notes live in this browser only.
        </p>
      </section>
    );
  }

  return (
    <section className="panel px-3.5 py-3">
      <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">Your journal</h2>
      <ul className="mt-2 divide-y divide-term-line/60">
        {entries.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-term-text">
                <TickerLink symbol={e.symbol} />
              </span>
              <span className="text-2xs text-term-faint">{STYLE_LABEL[e.style]}</span>
              <button
                type="button"
                onClick={() => setEntries(removeJournalEntry(e.id))}
                className="ml-auto text-2xs text-term-faint hover:text-bear"
              >
                remove
              </button>
            </div>
            <p className="mt-0.5 text-xs text-term-dim">{e.thesis}</p>
            <p className="mt-0.5 text-2xs text-term-faint">
              {journalSurfaceLine(e, nowBySymbol[e.symbol.toUpperCase()] ?? null)}
            </p>
            <p className="mt-0.5 text-2xs text-term-faint">Planned invalidation: {e.snapshot.invalidation}</p>
            <input
              type="text"
              defaultValue={e.outcome ?? ''}
              placeholder="Outcome note after exit…"
              onBlur={(ev) => setEntries(setJournalOutcome(e.id, ev.target.value))}
              className="mt-1 w-full border border-term-line bg-term-panel/60 px-2 py-1 text-2xs text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
