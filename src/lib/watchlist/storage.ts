'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-device watchlist, kept in localStorage.
 *
 * There is no login, so this is deliberately device-local: nothing is sent to
 * a server and nothing identifies the visitor. The trade-off is stated on the
 * page — clearing site data or switching browser loses the list.
 *
 * Implemented with `useSyncExternalStore` rather than an effect that seeds
 * state: localStorage IS an external store, and this is the primitive React
 * provides for reading one. It also gets the server/hydration split right for
 * free — the server snapshot is empty, so the markup matches until hydration
 * completes and React swaps in the real list.
 */

const KEY = 'gammadesk.watchlist.v1';
/** Kept small enough that the scores endpoint stays a single quick batch. */
export const MAX_WATCHLIST = 30;

/** Same allow-list the server uses, so nothing unusable can be stored. */
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;

export function isValidSymbol(raw: string): boolean {
  return SYMBOL_PATTERN.test(raw.trim().toUpperCase());
}

/** Fired on change so every star on the page updates together. */
const EVENT = 'gammadesk:watchlist';

/** Stable empty reference — returning a fresh [] would loop the store. */
const EMPTY: string[] = [];

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const clean = [
      ...new Set(
        value
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.toUpperCase())
          .filter(isValidSymbol),
      ),
    ].slice(0, MAX_WATCHLIST);
    return clean.length === 0 ? EMPTY : clean;
  } catch {
    return EMPTY;
  }
}

/*
 * `getSnapshot` must return a referentially stable value between changes, or
 * React re-renders forever. The parsed array is therefore memoised against the
 * raw string it came from.
 */
let lastRaw: string | null = null;
let lastParsed: string[] = EMPTY;

function getSnapshot(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastParsed = parse(raw);
  }
  return lastParsed;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  // `storage` covers other tabs; the custom event covers this one.
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function write(symbols: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(symbols));
  } catch {
    // Private browsing and full quotas both throw here. The event still fires,
    // so the UI stays consistent for the session even if nothing persisted.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** True only once hydration has completed, without any effect or setState. */
const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export interface WatchlistApi {
  symbols: string[];
  /** False during SSR and the hydration render, to keep markup stable. */
  ready: boolean;
  has: (symbol: string) => boolean;
  toggle: (symbol: string) => void;
  remove: (symbol: string) => void;
  clear: () => void;
  full: boolean;
}

export function useWatchlist(): WatchlistApi {
  const symbols = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useHydrated();

  const toggle = useCallback((raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (!isValidSymbol(symbol)) return;

    const current = getSnapshot();
    write(
      current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol].slice(0, MAX_WATCHLIST),
    );
  }, []);

  const remove = useCallback((raw: string) => {
    const symbol = raw.trim().toUpperCase();
    write(getSnapshot().filter((s) => s !== symbol));
  }, []);

  const clear = useCallback(() => write([]), []);

  return {
    symbols,
    ready,
    has: (symbol: string) => symbols.includes(symbol.trim().toUpperCase()),
    toggle,
    remove,
    clear,
    full: symbols.length >= MAX_WATCHLIST,
  };
}
