/**
 * The personal decision journal — a saved note on a ticker, kept in the same
 * place as the saved scanner presets: the browser's localStorage, per device.
 * No server, no account; it is the reader's own scratch record.
 *
 * The pure parts here (the surface line, the entry shape) are testable without
 * a DOM; the read/write helpers are wrapped in try/catch and degrade to an
 * empty journal when storage is unavailable, exactly as the preset store does.
 */

import type { Direction } from './directionScore';
import type { SetupState } from './daily20';

/** How the reader intends to hold it — their own classification, not advice. */
export type IntendedStyle = 'intraday' | 'weekly' | 'monthly' | 'swing';

export const STYLE_LABEL: Record<IntendedStyle, string> = {
  intraday: 'Intraday',
  weekly: 'Weekly',
  monthly: 'Monthly',
  swing: 'Swing shares',
};

export interface JournalEntry {
  id: string;
  symbol: string;
  direction: Direction;
  /** The reader's one-sentence thesis. */
  thesis: string;
  style: IntendedStyle;
  /** `YYYY-MM-DD` the note was saved. */
  savedAt: string;
  /** The date-stamped snapshot at save time. */
  snapshot: {
    score: number;
    lifecycleLabel: string;
    setup: SetupState;
    /** The invalidation line as it stood when saved. */
    invalidation: string;
  };
  /** Filled in after the position is closed. Null until then. */
  outcome: string | null;
}

/** What the current Daily 20 says about a journalled name, for the surface line. */
export interface JournalNow {
  score: number;
  lifecycleLabel: string;
  /** True when the name is now extended/stretched. */
  extended: boolean;
  /** Set when the name sits near its relevant gamma level. */
  nearLevel?: boolean;
}

/**
 * The plain-English surface line GammaDesk shows later, e.g.
 * "You saved this as a Pullback Leader on Oct 14 — score rose 71 → 86, now
 * extended and near the upper gamma level."
 *
 * With no `now` (the name has left the Daily 20, or today's scan is absent) it
 * states only what was saved.
 */
export function journalSurfaceLine(entry: JournalEntry, now?: JournalNow | null): string {
  const base = `You saved this as a ${entry.snapshot.lifecycleLabel} ${entry.direction === 'bullish' ? 'leader' : 'laggard'} on ${entry.savedAt}`;
  if (!now) return `${base}.`;

  const from = Math.round(entry.snapshot.score);
  const to = Math.round(now.score);
  const verb = to > from ? 'rose' : to < from ? 'fell' : 'held';
  const scorePart = ` — score ${verb} ${from} → ${to}`;

  const tags: string[] = [];
  if (now.lifecycleLabel && now.lifecycleLabel !== entry.snapshot.lifecycleLabel) {
    tags.push(`now ${now.lifecycleLabel.toLowerCase()}`);
  } else if (now.extended) {
    tags.push('now extended');
  }
  if (now.nearLevel) tags.push('near the relevant gamma level');

  return `${base}${scorePart}${tags.length ? `, ${tags.join(' and ')}` : ''}.`;
}

// --- localStorage, like the scanner presets ----------------------------------

const KEY = 'gammadesk:scanner:journal';
const MAX_ENTRIES = 100;

export function readJournal(): JournalEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeJournal(entries: JournalEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    // Let other mounted panels on the page refresh without a reload.
    window.dispatchEvent(new CustomEvent('gammadesk:journal'));
  } catch {
    // Storage disabled / full — the note simply is not kept.
  }
}

export function addJournalEntry(entry: JournalEntry): JournalEntry[] {
  const next = [entry, ...readJournal().filter((e) => e.id !== entry.id)];
  writeJournal(next);
  return next;
}

export function removeJournalEntry(id: string): JournalEntry[] {
  const next = readJournal().filter((e) => e.id !== id);
  writeJournal(next);
  return next;
}

export function setJournalOutcome(id: string, outcome: string): JournalEntry[] {
  const next = readJournal().map((e) => (e.id === id ? { ...e, outcome } : e));
  writeJournal(next);
  return next;
}

/** A stable-ish id without pulling in a uuid dep. */
export function journalId(symbol: string, savedAt: string): string {
  return `${symbol}-${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
}
