/**
 * Parsing thinkorswim scan-alert email text (subject or body).
 *
 * thinkorswim describes each event in one clause, and a single email can carry
 * MORE THAN ONE — an addition and a removal together:
 *
 *   Alert: New symbols: BBWI, MRNA, TEM were added to Trend.
 *   Alert: Symbols: XYZ were removed from Trend.
 *   Alert: New symbols: AMD, TSLA were added to Trend. Symbols: MRVL, NOK were removed from Trend.
 *
 * So this does NOT match one clause anchored to the end of the string — that
 * read the scan name of the first clause as "Trend. Symbols: … removed from
 * Trend" and dropped the whole email. Instead it finds EVERY
 * "(New) symbol(s): <list> was/were added to|removed from <scan>" clause in the
 * text, in order, and returns them all. The caller keeps the ones whose scan is
 * exactly "Trend" and applies each in turn.
 *
 * Robustness:
 *   - `was`/`were`, `added to`/`removed from`, `symbol`/`symbols`, optional
 *     leading `New`, optional trailing period — all tolerated.
 *   - tickers with a dot or slash (BRK.B, /ES) are kept intact; every token in
 *     a list is validated as a ticker rather than trusted.
 *   - the scan name is read up to the clause's period/newline/end, so it is
 *     isolated even when another clause follows on the same line.
 *   - matching runs over the whole text, so a multi-line body works as well as
 *     a subject.
 *
 * Pure — no I/O, no `server-only` — so the poller and the unit tests can both
 * import it.
 */

/** The scan whose alerts this feature acts on. Every other scan is ignored. */
export const TREND_SCAN = 'Trend';

export type TrendAction = 'added' | 'removed';

export interface AlertClause {
  /** Which scan the clause belongs to, exactly as written. */
  scan: string;
  action: TrendAction;
  /** Uppercased, de-duplicated, in the order they appeared. */
  symbols: string[];
}

/** Back-compat alias — one clause looks the same as it used to. */
export type AlertSubject = AlertClause;

/**
 * One clause. Global + case-insensitive so `parseAlertClauses` can iterate over
 * every clause in the text.
 *
 *   (New )?symbol(s): <list> was/were added to|removed from <scan>[.|\n|EOL]
 *
 * `list` is lazy so it stops at the first `was/were`; `scan` excludes `.` and
 * newlines so it ends at the clause boundary rather than swallowing the next
 * clause.
 */
const CLAUSE_RE =
  /(?:new\s+)?symbols?\s*:\s*(?<list>[\s\S]+?)\s+(?:was|were)\s+(?<action>added\s+to|removed\s+from)\s+(?<scan>[^.\r\n]+?)\s*(?:\.|\r|\n|$)/gi;

/**
 * A single ticker. Letters to start (optionally behind a `/` for a futures
 * root like /ES), then letters or digits, with dot- or slash-joined suffixes
 * for names like BRK.B. Strict, so a stray word in a list is dropped rather
 * than stored as a symbol.
 */
const TICKER_RE = /^\/?[A-Za-z][A-Za-z0-9]*(?:[.\/][A-Za-z0-9]+)*$/;

/** Split a captured list on commas, the word "and", and whitespace. */
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
 * Every add/remove clause found in the text, in order. Empty when the text is
 * not a recognisable alert at all.
 */
export function parseAlertClauses(text: string | null | undefined): AlertClause[] {
  if (!text) return [];

  const out: AlertClause[] = [];
  // A global regex is stateful; reset before iterating in case a prior throw
  // left lastIndex advanced.
  CLAUSE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLAUSE_RE.exec(text)) !== null) {
    if (!match.groups) continue;
    const symbols = tickersFrom(match.groups.list);
    if (symbols.length === 0) continue; // e.g. "symbols: were added" — no tickers
    out.push({
      scan: match.groups.scan.trim(),
      action: match.groups.action.toLowerCase().startsWith('added') ? 'added' : 'removed',
      symbols,
    });
  }
  return out;
}

/** True when a scan name is the Trend scan, case- and space-insensitive. */
export function isTrendScan(scan: string): boolean {
  return scan.trim().toLowerCase() === TREND_SCAN.toLowerCase();
}

export interface TrendOp {
  action: TrendAction;
  symbols: string[];
}

/**
 * The Trend-scan add/remove operations in the text, in the order they appear —
 * the sequence the poller applies. Clauses for any other scan are dropped.
 */
export function parseTrendOps(text: string | null | undefined): TrendOp[] {
  return parseAlertClauses(text)
    .filter((c) => isTrendScan(c.scan))
    .map((c) => ({ action: c.action, symbols: c.symbols }));
}

/**
 * The FIRST clause in the text, or null. Retained for callers and tests that
 * treat one email as one clause; new code should prefer {@link parseAlertClauses}.
 */
export function parseAlertSubject(text: string | null | undefined): AlertClause | null {
  return parseAlertClauses(text)[0] ?? null;
}

/** The first Trend-scan operation in the text, or null. Back-compat helper. */
export function parseTrendAlert(text: string | null | undefined): TrendOp | null {
  return parseTrendOps(text)[0] ?? null;
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

/** Apply a whole sequence of operations in order. */
export function applyTrendOps(current: readonly string[], ops: readonly TrendOp[]): string[] {
  let symbols = [...current];
  for (const op of ops) {
    symbols = applyTrendChange(symbols, op.action, op.symbols);
  }
  return symbols;
}
