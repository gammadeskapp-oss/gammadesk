import type { Gics } from '@/lib/rs/universe';
import type { MacroAlignment } from './mock';

/**
 * A macro-sensitivity tag for a ticker, driven by its GICS sector.
 *
 * Every S&P 500 name carries an official GICS sector in the membership record
 * (`rs/membership`, refreshed weekly), so the tag is derived from that rather
 * than a hand-maintained list — one lookup, full coverage, and it tracks index
 * changes automatically. A small override list promotes names whose sector
 * understates how they trade (Amazon and Tesla are Consumer Discretionary by
 * GICS but move like growth). An earnings print inside a day overrides the
 * standing sensitivity, because that is the nearer risk. "No strong macro tilt"
 * is reserved for when the sector is genuinely unknown (an ETF that is not a
 * constituent, a name missing from the parse).
 *
 * Shared so the Home shortlist, the Scanner column and filter, and the Decision
 * macro-fit box all read the same rule rather than drifting apart.
 */

/**
 * GICS sector → macro category.
 *
 *   Technology, Communication Services            → growth (rate-sensitive via yields)
 *   Financials, Real Estate                       → rate-sensitive
 *   Consumer Staples, Utilities, Health Care      → defensive
 *   Industrials, Energy, Materials, Cons. Disc.   → cyclical
 *
 * Consumer Discretionary is cyclical by default; the high-growth names within
 * it are promoted by `MANUAL_OVERRIDE`.
 */
export const SECTOR_CATEGORY: Record<Gics, MacroAlignment> = {
  technology: 'growth',
  'communication-services': 'growth',
  financials: 'rate-sensitive',
  'real-estate': 'rate-sensitive',
  'consumer-staples': 'defensive',
  utilities: 'defensive',
  'health-care': 'defensive',
  industrials: 'cyclical',
  energy: 'cyclical',
  materials: 'cyclical',
  'consumer-discretionary': 'cyclical',
};

/**
 * Names whose GICS sector understates how they trade against the macro backdrop.
 * Checked before the sector map (but after an imminent earnings print).
 */
export const MANUAL_OVERRIDE: Record<string, MacroAlignment> = {
  AMZN: 'growth',
  TSLA: 'growth',
};

/**
 * Sector / index ETFs are not index constituents, so they carry no GICS sector
 * from membership. This keeps their tag sensible when one is looked up directly
 * (e.g. on /decision for XLK) rather than falling through to "no tilt".
 */
const ETF_FALLBACK: Record<string, MacroAlignment> = {
  XLK: 'growth', XLC: 'growth', SMH: 'growth', SOXX: 'growth', QQQ: 'growth', VGT: 'growth',
  XLF: 'rate-sensitive', KRE: 'rate-sensitive', XLRE: 'rate-sensitive',
  XLP: 'defensive', XLU: 'defensive', XLV: 'defensive',
  XLI: 'cyclical', XLE: 'cyclical', XLB: 'cyclical', XLY: 'cyclical',
};

export interface MacroAlignmentOpts {
  /** The name's GICS sector, from `sectorMap(members)`; null when unknown. */
  sector?: Gics | null;
  /** True when the name reports inside the next 24 hours. */
  earningsWithin24h?: boolean;
}

/**
 * Tag one name. Order of precedence: an imminent earnings print, then a manual
 * override, then the GICS sector, then an ETF fallback, then "no tilt".
 */
export function macroAlignmentFor(symbol: string, opts: MacroAlignmentOpts = {}): MacroAlignment {
  const { sector = null, earningsWithin24h: earnings = false } = opts;
  if (earnings) return 'event-risk';
  const s = symbol.toUpperCase();
  if (MANUAL_OVERRIDE[s]) return MANUAL_OVERRIDE[s];
  if (sector) return SECTOR_CATEGORY[sector];
  if (ETF_FALLBACK[s]) return ETF_FALLBACK[s];
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
