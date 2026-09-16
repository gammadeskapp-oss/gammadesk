/**
 * Parsing thinkorswim scan-alert email subjects.
 *
 * thinkorswim emails one line per event, in the subject, and nothing this
 * feature needs is in the body. Two shapes, both seen from
 * alerts@thinkorswim.com:
 *
 *   Alert: New symbols: BBWI, MRNA, TEM were added to Trend.
 *   Alert: Symbols: XYZ were removed from Trend.
 *
 * The wording is not stable enough to match literally. It varies by:
 *   - was / were, for one symbol vs several
 *   - added to / removed from
 *   - symbol / symbols, likewise
 *   - an optional trailing period
 *   - tickers that carry a dot or a slash — BRK.B, /ES
 *   - a leading "New " before "symbols", present on additions only
 *
 * So the subject is matched with one tolerant expression, and every token in
 * the captured list is validated as a ticker rather than trusted. Anything
 * that does not match at all returns null; the caller logs those, because a
 * subject from thinkorswim that this cannot read is the signal that the format
 * moved and this file needs revisiting.
 *
 * This module is deliberately pure — no I/O, no `server-only` — so the poller
 * and the unit test can both import it.
 */

/** The scan whose alerts this feature acts on. Every other scan is ignored. */
export const TREND_SCAN = 'Trend';

export type TrendAction = 'added' | 'removed';

export interface AlertSubject {
  /** Which scan the alert belongs to, exactly as written in the subject. */
  scan: string;
  action: TrendAction;
  /** Uppercased, de-duplicated, in the order they appeared. */
  symbols: string[];
}

/**
 * The whole grammar, in one expression.
 *
 * Not anchored at the start, so the leading "Alert:" and an optional "New "
 * are simply skipped — matching begins at "symbol(s):". The list is captured
 * up to the "was/were" hinge, and the scan name is whatever follows the
 * action verb, minus an optional trailing period.
 */
const SUBJECT_RE =
  /\bsymbols?:\s*(?<list>[^:]+?)\s+(?:was|were)\s+(?<action>added\s+to|removed\s+from)\s+(?<scan>.+?)\.?\s*$/i;

/**
 * A single ticker. Letters to start (optionally behind a `/` for a futures
 * root like /ES), then letters or digits, with dot- or slash-joined suffixes
 * for names like BRK.B. Kept strict so a stray word between the colon and the
 * verb is dropped rather than stored as a symbol.
 */
const TICKER_RE = /^\/?[A-Za-z][A-Za-z0-9]*(?:[.\/][A-Za-z0-9]+)*$/;

/** Split the captured list on commas, the word "and", and whitespace. */
function tickersFrom(list: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list.split(/\s*,\s*|\s+and\s+|\s+/i)) {
    const token = raw.trim();
    if (!token || !TICKER_RE.test(token)) continue;
    const symbol = token.toUpperCase();
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

/**
 * Parse one alert subject into its scan, action and symbols, or null when the
 * subject is not a recognised add/remove alert. Says nothing about which scan
 * it is — that judgement is left to the caller via {@link isTrendScan}.
 */
export function parseAlertSubject(subject: string | null | undefined): AlertSubject | null {
  if (!subject) return null;

  const match = SUBJECT_RE.exec(subject);
  if (!match?.groups) return null;

  const symbols = tickersFrom(match.groups.list);
  if (symbols.length === 0) return null;

  return {
    scan: match.groups.scan.trim(),
    action: match.groups.action.toLowerCase().startsWith('added') ? 'added' : 'removed',
    symbols,
  };
}

/** True when a parsed scan name is the Trend scan, case- and space-insensitive. */
export function isTrendScan(scan: string): boolean {
  return scan.trim().toLowerCase() === TREND_SCAN.toLowerCase();
}

/**
 * Parse a subject and keep it only if it belongs to the Trend scan. Returns
 * null for junk, and for alerts about any other scan — the single call the
 * poller makes per email.
 */
export function parseTrendAlert(
  subject: string | null | undefined,
): Omit<AlertSubject, 'scan'> | null {
  const parsed = parseAlertSubject(subject);
  if (!parsed || !isTrendScan(parsed.scan)) return null;
  return { action: parsed.action, symbols: parsed.symbols };
}

/**
 * Apply one add/remove to the running list, returning a new uppercase,
 * de-duplicated, sorted array. Adding a name already present, or removing one
 * absent, is a no-op — email delivery is not exactly-once, so the same alert
 * can arrive twice and must land on the same list.
 */
export function applyTrendChange(
  current: readonly string[],
  action: TrendAction,
  symbols: readonly string[],
): string[] {
  const set = new Set(current.map((s) => s.toUpperCase()));
  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    if (action === 'added') set.add(symbol);
    else set.delete(symbol);
  }
  return [...set].sort();
}
