/**
 * Getting the reader's settings into the URL and back, and into localStorage
 * and back.
 *
 * ## Why the URL and not just component state
 *
 * A rule set nobody can send to anyone else is a rule set nobody can be
 * challenged on. The whole point of making the cutoffs adjustable is that the
 * reader can say "here is what I actually looked at" — which needs a link. So
 * every control round-trips through the query string, and a pasted URL
 * reproduces the exact list the person who sent it was reading.
 *
 * ## Only what differs is written
 *
 * A URL carrying all twelve controls at their shipped values would be
 * unreadable and would make every link look like a custom configuration. Only
 * fields that differ from `DEFAULT_FILTERS` are serialised, so `/scanner` is
 * the default set, `/scanner?rs=75` is one deliberate change, and the
 * difference between them is visible at a glance in the address bar.
 */

import {
  clampSettings,
  DEFAULT_FILTERS,
  type FilterSettings,
} from './score';
import { RULE_KEYS, type RuleKey } from './types';

/**
 * Query-string keys.
 *
 * Short, because they end up in a link someone reads. Pinned in one object
 * because reading and writing must use the same names, and a typo in either
 * direction produces a link that silently loses a setting.
 */
const KEY = {
  rsMin: 'rs',
  volumeMult: 'vol',
  minDollarVolume: 'liq',
  trendPct: 'trend',
  dteMin: 'dte0',
  dteMax: 'dte1',
  deltaMin: 'd0',
  deltaMax: 'd1',
  earningsBufferDays: 'earn',
  off: 'off',
  calm: 'calm',
} as const;

function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read settings out of a query string.
 *
 * Anything absent or unparseable falls back to the shipped default and
 * everything is clamped to its slider bounds, so a hand-edited or truncated
 * link degrades to a sensible list rather than to an error page or to a
 * configuration nothing can be true at.
 */
export function settingsFromParams(params: URLSearchParams): FilterSettings {
  /*
   * Disabled rules travel as one comma-separated `off` list rather than five
   * booleans. Five `rs=1&ema=1&...` pairs would be most of the URL and would
   * be there on every link, including the ones where nothing was switched off.
   */
  const off = new Set(
    (params.get(KEY.off) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const enabled = {} as Record<RuleKey, boolean>;
  for (const key of RULE_KEYS) enabled[key] = !off.has(key);

  return clampSettings({
    rsMin: num(params, KEY.rsMin, DEFAULT_FILTERS.rsMin),
    volumeMult: num(params, KEY.volumeMult, DEFAULT_FILTERS.volumeMult),
    minDollarVolume: num(params, KEY.minDollarVolume, DEFAULT_FILTERS.minDollarVolume),
    trendPct: num(params, KEY.trendPct, DEFAULT_FILTERS.trendPct),
    dteMin: num(params, KEY.dteMin, DEFAULT_FILTERS.dteMin),
    dteMax: num(params, KEY.dteMax, DEFAULT_FILTERS.dteMax),
    deltaMin: num(params, KEY.deltaMin, DEFAULT_FILTERS.deltaMin),
    deltaMax: num(params, KEY.deltaMax, DEFAULT_FILTERS.deltaMax),
    earningsBufferDays: num(
      params,
      KEY.earningsBufferDays,
      DEFAULT_FILTERS.earningsBufferDays,
    ),
    enabled,
    requireCalmMarket: params.get(KEY.calm) === '1',
  });
}

/** Serialise the difference from the defaults. Empty string when there is none. */
export function paramsFromSettings(settings: FilterSettings): string {
  const params = new URLSearchParams();
  const d = DEFAULT_FILTERS;

  const put = (key: string, value: number, fallback: number) => {
    if (value !== fallback) params.set(key, String(round(value)));
  };

  put(KEY.rsMin, settings.rsMin, d.rsMin);
  put(KEY.volumeMult, settings.volumeMult, d.volumeMult);
  put(KEY.minDollarVolume, settings.minDollarVolume, d.minDollarVolume);
  put(KEY.trendPct, settings.trendPct, d.trendPct);
  put(KEY.dteMin, settings.dteMin, d.dteMin);
  put(KEY.dteMax, settings.dteMax, d.dteMax);
  put(KEY.deltaMin, settings.deltaMin, d.deltaMin);
  put(KEY.deltaMax, settings.deltaMax, d.deltaMax);
  put(KEY.earningsBufferDays, settings.earningsBufferDays, d.earningsBufferDays);

  const off = RULE_KEYS.filter((key) => !settings.enabled[key]);
  if (off.length > 0) params.set(KEY.off, off.join(','));

  if (settings.requireCalmMarket) params.set(KEY.calm, '1');

  return params.toString();
}

/** Trim float noise so `1.0500000000000003` never reaches the address bar. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function isDefault(settings: FilterSettings): boolean {
  return paramsFromSettings(settings) === '';
}

// --- saved presets -----------------------------------------------------------

export interface SavedPreset {
  name: string;
  settings: FilterSettings;
}

/**
 * Where the reader's own named configurations live.
 *
 * localStorage and not the server, deliberately. These are one person's
 * working preferences on one browser; putting them in storage the scan reads
 * would make a reader's private tuning into an input to a job everyone else's
 * page renders from.
 */
const STORAGE_KEY = 'gammadesk:scanner:presets';

/** Kept small on purpose — a dropdown of twenty saved views is a filing system. */
export const MAX_SAVED_PRESETS = 4;

function readFromStorage(): SavedPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    /*
     * Every stored entry is re-clamped on the way out. A preset saved before a
     * bound moved would otherwise reinstate a value the sliders can no longer
     * express, and the controls and the list would disagree about what was
     * being applied.
     */
    return parsed
      .filter(
        (entry): entry is SavedPreset =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as SavedPreset).name === 'string' &&
          !!(entry as SavedPreset).settings,
      )
      .slice(0, MAX_SAVED_PRESETS)
      .map((entry) => ({
        name: entry.name,
        settings: clampSettings({ ...DEFAULT_FILTERS, ...entry.settings }),
      }));
  } catch {
    // A browser with storage disabled, or a corrupted entry. No presets is a
    // working page; a thrown error is not.
    return [];
  }
}

/**
 * localStorage as an external store, so React can read it without an effect.
 *
 * ## Why the caching is load-bearing, not an optimisation
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders when
 * they differ. `readFromStorage` parses JSON and builds a fresh array every
 * call, so handing it straight to the hook would return a new array on every
 * render, differ from the last one every time, and spin. The cache makes the
 * snapshot stable between actual writes, which is the contract the hook is
 * asking for.
 *
 * The pay-off is that the presets read like any other value — no mount effect
 * setting state, no first paint with the wrong list — while still coming from
 * a place that does not exist during server rendering.
 */
let cache: SavedPreset[] | null = null;
const listeners = new Set<() => void>();

/** Stable identity for the server and for a browser with storage blocked. */
const EMPTY: SavedPreset[] = [];

export function subscribeSavedPresets(listener: () => void): () => void {
  listeners.add(listener);
  /*
   * `storage` fires only for *other* tabs, which is exactly the case a local
   * cache would otherwise miss: save a configuration in one tab and the
   * scanner open in another would keep showing the old list until reload.
   */
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function readSavedPresets(): SavedPreset[] {
  if (typeof window === 'undefined') return EMPTY;
  cache ??= readFromStorage();
  return cache;
}

export function readSavedPresetsOnServer(): SavedPreset[] {
  return EMPTY;
}

export function writeSavedPresets(presets: SavedPreset[]): void {
  const next = presets.slice(0, MAX_SAVED_PRESETS);
  cache = next;
  for (const listener of listeners) listener();

  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked. The cache above still serves this visit, so the
    // configuration works now and simply does not survive a reload.
  }
}

// --- the address bar, as an external store -----------------------------------

/**
 * The query string, read the same way.
 *
 * Server-rendered as empty, which renders the shipped defaults; the hook then
 * re-renders with the real search string once hydrated. That is what
 * `useSyncExternalStore` exists for, and it is why the settings can live in
 * the URL without a hydration mismatch or a mount effect.
 */
export function subscribeLocationSearch(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

export function readLocationSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

export function readLocationSearchOnServer(): string {
  return '';
}
