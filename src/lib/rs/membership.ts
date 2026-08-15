import 'server-only';

import { cached } from '../cache';
import { createJsonStore } from '../jsonStore';
import { RS_SCHEMA } from './types';
import {
  seedConstituents,
  toConstituents,
  type Constituent,
} from './universe';

/**
 * Who is in the S&P 500 this week.
 *
 * ## Sourcing
 *
 * There is no free, stable, machine-readable feed of index membership — S&P
 * licenses it. The two usable substitutes are Wikipedia's *List of S&P 500
 * companies*, which is edited within a day or two of any change, and the
 * `datasets/s-and-p-500-companies` CSV on GitHub, which is generated from that
 * same page on a schedule. Wikipedia is tried first because it is fresher; the
 * CSV is the fallback because it is a static file with no HTML to break.
 *
 * Both are scraped, and scraping is the risk this module exists to contain.
 *
 * ## The failure mode that matters
 *
 * A scraper that silently returns forty symbols one morning would not throw —
 * it would quietly rank forty stocks and present percentiles computed against
 * forty names as if they were computed against five hundred. Every number on
 * the page would look completely normal and be wrong. So a fetched list is
 * accepted only if it passes `plausible()` below, and a rejected fetch leaves
 * the previous stored list in place rather than replacing it with something
 * worse. Membership changes by a handful of names a quarter; there is no
 * legitimate reason for it to change by hundreds overnight.
 *
 * ## Cadence
 *
 * Weekly. The index reconstitutes quarterly with occasional one-off
 * replacements, so a list at most seven days old is never meaningfully wrong,
 * and a symbol that leaves the index in the meantime simply keeps being ranked
 * for a few days — visible in the notes, harmless to the percentiles.
 */

export type MembershipSource = 'wikipedia' | 'csv' | 'stored' | 'seed';

export interface StoredMembership {
  schema: number;
  members: Constituent[];
  source: MembershipSource;
  fetchedAt: string;
  /** Symbols added and removed against the list this one replaced. */
  added: string[];
  removed: string[];
}

export interface Membership {
  members: Constituent[];
  source: MembershipSource;
  fetchedAt: string | null;
  added: string[];
  removed: string[];
  notes: string[];
}

const store = createJsonStore<StoredMembership | null>(
  'gammadesk/rs-members.json',
  () => null,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as StoredMembership;
    if (doc.schema !== RS_SCHEMA) return null;
    if (!Array.isArray(doc.members) || doc.members.length === 0) return null;
    return doc;
  },
);

/** How old a stored list may be before it is refetched. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** In-process reuse, so a burst of views shares one store read. */
const MEMO_SECONDS = 900;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const WIKIPEDIA_URL =
  'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const CSV_URL =
  'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';

// --- plausibility -------------------------------------------------------------

/**
 * Anchors that have been in the index for decades and are not plausibly
 * leaving it in the same week. Their absence means the parse went wrong, not
 * that the index changed.
 */
const ANCHORS = ['AAPL', 'MSFT', 'JPM', 'JNJ', 'XOM'];

/** The index is 500 companies and ~503 share classes; allow generous slack. */
const MIN_MEMBERS = 400;
const MAX_MEMBERS = 600;

function plausible(members: Constituent[]): string | null {
  if (members.length < MIN_MEMBERS) {
    return `only ${members.length} symbols parsed, expected at least ${MIN_MEMBERS}`;
  }
  if (members.length > MAX_MEMBERS) {
    return `${members.length} symbols parsed, expected at most ${MAX_MEMBERS}`;
  }

  const present = new Set(members.map((m) => m.symbol));
  const missing = ANCHORS.filter((a) => !present.has(a));
  if (missing.length > 0) {
    return `bellwether symbols missing from the parse: ${missing.join(', ')}`;
  }

  const withSector = members.filter((m) => m.sector !== null).length;
  if (withSector < members.length * 0.9) {
    return `only ${withSector} of ${members.length} symbols carried a recognised GICS sector`;
  }

  return null;
}

// --- Wikipedia ----------------------------------------------------------------

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pull the constituents table out of the rendered article.
 *
 * Columns are located by their header text rather than by position. The page
 * has gained and lost columns over the years — CIK, Founded, Date added — and
 * a fixed index silently starts reading sub-industries as sectors the first
 * time one moves.
 */
function parseWikipedia(html: string): Array<{ symbol: string; sector: string }> {
  // The constituents table carries this id; the second table on the page is
  // the list of recent changes, which must not be read as membership.
  const start = html.indexOf('id="constituents"');
  if (start === -1) return [];

  const tableEnd = html.indexOf('</table>', start);
  const table = html.slice(start, tableEnd === -1 ? undefined : tableEnd);

  const rows = table.split(/<tr\b/i).slice(1);
  if (rows.length === 0) return [];

  const headers = [...rows[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    stripTags(m[1]).toLowerCase(),
  );

  const symbolAt = headers.findIndex((h) => h.startsWith('symbol') || h === 'ticker');
  const sectorAt = headers.findIndex((h) => h.includes('sector'));
  if (symbolAt === -1 || sectorAt === -1) return [];

  const out: Array<{ symbol: string; sector: string }> = [];

  for (const row of rows.slice(1)) {
    // Wikipedia renders the first cell of each data row as a <th> in this
    // table, so both cell types have to be collected, in document order.
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      stripTags(m[1]),
    );
    if (cells.length <= Math.max(symbolAt, sectorAt)) continue;

    const symbol = cells[symbolAt];
    const sector = cells[sectorAt];
    if (symbol) out.push({ symbol, sector });
  }

  return out;
}

// --- CSV ----------------------------------------------------------------------

/** One CSV line, honouring quoted fields that contain commas. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field.trim());
      field = '';
    } else field += ch;
  }

  out.push(field.trim());
  return out;
}

function parseCsv(text: string): Array<{ symbol: string; sector: string }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];

  const headers = csvFields(lines[0]).map((h) => h.toLowerCase());
  const symbolAt = headers.findIndex((h) => h.startsWith('symbol') || h === 'ticker');
  const sectorAt = headers.findIndex((h) => h.includes('sector'));
  if (symbolAt === -1 || sectorAt === -1) return [];

  const out: Array<{ symbol: string; sector: string }> = [];
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    if (fields.length <= Math.max(symbolAt, sectorAt)) continue;
    const symbol = fields[symbolAt];
    if (symbol) out.push({ symbol, sector: fields[sectorAt] });
  }

  return out;
}

// --- fetching -----------------------------------------------------------------

async function fromWikipedia(): Promise<Constituent[] | null> {
  const res = await fetch(WIKIPEDIA_URL, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const members = toConstituents(parseWikipedia(await res.text()));
  return members.length > 0 ? members : null;
}

async function fromCsv(): Promise<Constituent[] | null> {
  const res = await fetch(CSV_URL, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/csv' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const members = toConstituents(parseCsv(await res.text()));
  return members.length > 0 ? members : null;
}

function diff(next: Constituent[], previous: Constituent[] | null) {
  if (!previous) return { added: [], removed: [] };
  const before = new Set(previous.map((m) => m.symbol));
  const after = new Set(next.map((m) => m.symbol));
  return {
    added: next.filter((m) => !before.has(m.symbol)).map((m) => m.symbol).sort(),
    removed: previous.filter((m) => !after.has(m.symbol)).map((m) => m.symbol).sort(),
  };
}

/**
 * Refetch membership and store it. Used by the weekly cron and the lazy path.
 *
 * Each source is tried in turn and the first *plausible* result wins — a
 * source that responds with something implausible is skipped rather than
 * accepted, so a mangled Wikipedia render falls through to the CSV instead of
 * poisoning the store.
 */
export async function refreshMembership(): Promise<Membership> {
  const stored = await store.read().catch(() => null);
  const notes: string[] = [];

  const sources: Array<[MembershipSource, () => Promise<Constituent[] | null>]> = [
    ['wikipedia', fromWikipedia],
    ['csv', fromCsv],
  ];

  for (const [source, fetcher] of sources) {
    let members: Constituent[] | null = null;
    try {
      members = await fetcher();
    } catch (error) {
      notes.push(
        `${source} membership fetch failed: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      );
      continue;
    }

    if (!members) {
      notes.push(`${source} membership fetch returned nothing usable.`);
      continue;
    }

    const problem = plausible(members);
    if (problem) {
      notes.push(`${source} membership list rejected — ${problem}.`);
      continue;
    }

    const { added, removed } = diff(members, stored?.members ?? null);
    const doc: StoredMembership = {
      schema: RS_SCHEMA,
      members,
      source,
      fetchedAt: new Date().toISOString(),
      added,
      removed,
    };

    try {
      await store.write(doc);
    } catch {
      // Serve what we fetched even if it could not be persisted; the next run
      // will try again.
      notes.push('Membership was fetched but could not be stored.');
    }

    return { ...doc, notes };
  }

  // Everything failed. Keep whatever is stored rather than degrading to the
  // seed, which is almost certainly older than the last successful fetch.
  if (stored) {
    notes.push('Every membership source failed; serving the last stored list.');
    return { ...stored, source: 'stored', notes };
  }

  notes.push(
    'Every membership source failed and nothing is stored, so the built-in seed list is being used. It may be out of date.',
  );
  return {
    members: seedConstituents(),
    source: 'seed',
    fetchedAt: null,
    added: [],
    removed: [],
    notes,
  };
}

function ageMs(doc: StoredMembership): number {
  const at = Date.parse(doc.fetchedAt);
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

/**
 * The membership every caller reads. Refetches at most once a week.
 *
 * A refresh failure falls back to the stored list rather than propagating: a
 * week-old constituent list is a far better page than an error.
 */
export function getMembership(): Promise<Membership> {
  return cached('rs:membership', MEMO_SECONDS, async () => {
    const stored = await store.read().catch(() => null);

    if (stored && ageMs(stored) < MAX_AGE_MS) {
      return { ...stored, notes: [] };
    }

    try {
      return await refreshMembership();
    } catch {
      if (stored) return { ...stored, source: 'stored' as const, notes: [] };
      return {
        members: seedConstituents(),
        source: 'seed' as const,
        fetchedAt: null,
        added: [],
        removed: [],
        notes: ['Membership could not be fetched; using the built-in seed list.'],
      };
    }
  });
}

/** The stored list exactly as written, for the health check. */
export function peekStoredMembership(): Promise<StoredMembership | null> {
  return store.read().catch(() => null);
}
