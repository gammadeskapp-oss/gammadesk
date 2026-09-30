/**
 * A light, honest macro-alignment tag for a ticker.
 *
 * The full "Macro alignment" scanner column the redesign spec calls for wants a
 * per-name classification against the live macro backdrop. A rigorous version
 * needs a sector/sensitivity model the app does not yet compute, so this is the
 * defensible interim: a static sensitivity map for the names that actually show
 * up on the scanner shortlist, plus an `event-risk` override when the name
 * reports inside a day. It never invents a number — it tags a category, and
 * falls back to `aligned` (i.e. "no macro conflict flagged") when the name is
 * not in the map.
 *
 * Shared so the Home shortlist preview and the Scanner column read the same
 * rule rather than drifting apart.
 */

import type { MacroAlignment } from './mock';

/** Rate-sensitive: banks, rate-plays, long-duration growth that reprices on yields. */
const RATE_SENSITIVE = new Set([
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'KRE', 'XLF',
  'PLD', 'AMT', 'SPG', 'O', 'XLRE',
]);

/** Defensive: staples, utilities, healthcare — hold up when the backdrop sours. */
const DEFENSIVE = new Set([
  'WMT', 'COST', 'PG', 'KO', 'PEP', 'CL', 'MDLZ', 'XLP',
  'NEE', 'DUK', 'SO', 'XLU',
  'JNJ', 'UNH', 'ABBV', 'MRK', 'PFE', 'LLY', 'XLV',
]);

/** Cyclical: industrials, energy, materials, discretionary — geared to growth. */
const CYCLICAL = new Set([
  'CAT', 'DE', 'HON', 'GE', 'BA', 'UNP', 'XLI',
  'XOM', 'CVX', 'COP', 'SLB', 'XLE',
  'FCX', 'NUE', 'DOW', 'XLB',
  'HD', 'NKE', 'SBUX', 'MCD', 'XLY',
]);

/**
 * Tag one name. `earningsWithin24h` promotes it to `event-risk`, which takes
 * precedence over its standing sensitivity because a print inside the window is
 * the nearer risk.
 */
export function macroAlignmentFor(
  symbol: string,
  earningsWithin24h = false,
): MacroAlignment {
  if (earningsWithin24h) return 'event-risk';
  const s = symbol.toUpperCase();
  if (RATE_SENSITIVE.has(s)) return 'rate-sensitive';
  if (DEFENSIVE.has(s)) return 'defensive';
  if (CYCLICAL.has(s)) return 'cyclical';
  // Not in the sensitivity map — nothing flags it as conflicting with the
  // backdrop, so it reads as aligned rather than being given a made-up tag.
  return 'aligned';
}

/** True when an ISO earnings date falls within the next 24 hours of `now`. */
export function earningsWithin24h(
  earningsDateIso: string | null,
  now: Date = new Date(),
): boolean {
  if (!earningsDateIso) return false;
  const t = Date.parse(earningsDateIso);
  if (!Number.isFinite(t)) return false;
  const deltaHours = (t - now.getTime()) / 3_600_000;
  return deltaHours >= 0 && deltaHours <= 24;
}
