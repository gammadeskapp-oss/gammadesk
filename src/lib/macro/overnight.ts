import 'server-only';

import { cached } from '../cache';
import { fetchSparks } from '../breadth/spark';
import {
  OVERNIGHT_FLAT_PCT,
  rowClause,
  type OvernightRow,
} from './translate';

/**
 * The overnight global tape, from free Yahoo tickers, no key.
 *
 * ## Why this reuses the breadth module's spark fetcher
 *
 * `fetchSparks` is the same route the home page's context quotes use, and it
 * already carries the finding that Yahoo's documented batch-quote endpoint
 * returns 401 while spark works, chunked at twenty. Nine symbols is one chunk,
 * so this is one upstream request per cache period. Writing a second Yahoo
 * client here would be a second copy of those discoveries to keep in step.
 *
 * ## The overnight change is prior-close to latest
 *
 * Spark gives today's samples plus `previousClose`. Latest against previous
 * close is the honest overnight move for a session that spans time zones — the
 * same figure the context row shows — and it is all these rows need. No attempt
 * is made to define a precise "overnight window", because the instruments here
 * trade on different clocks and a single window would be wrong for most of them.
 *
 * ## The Japan 10-year is a proxy, and says so
 *
 * There is no free, reliable JGB 10-year *yield* ticker on the spark endpoint.
 * `1482.T` is an iShares JGB bond ETF — a **price**, which moves inversely to
 * yield. So its change is inverted before it casts a rates lean (a bond rally is
 * a yield fall), and the row is labelled a proxy so the reader knows the number
 * beside it is a bond price, not a yield. Everything downstream treats it as
 * "the Japan 10-year", which is the honest thing it stands in for.
 */

interface Instrument {
  /** Key into the translator's `OVERNIGHT_RULES`. */
  key: string;
  /** Yahoo's spelling. */
  symbol: string;
  /** How the row is labelled on screen. */
  label: string;
  /** What the number beside the label is, when it is not obvious. */
  unit?: string;
  /**
   * True when a rise in the quote means the opposite of a rise in the thing it
   * stands for — a bond-price proxy for a yield. The displayed number is the
   * real quote; only the lean is inverted.
   */
  invert?: boolean;
  /** Marks a stand-in rather than the instrument itself. */
  proxy?: boolean;
}

/** Order is the order the rows render in. */
const INSTRUMENTS: Instrument[] = [
  { key: 'USDJPY', symbol: 'JPY=X', label: 'USD/JPY' },
  { key: 'JGB10Y', symbol: '1482.T', label: 'Japan 10y', unit: ' (bond-ETF proxy)', invert: true, proxy: true },
  { key: 'NIKKEI', symbol: '^N225', label: 'Nikkei 225' },
  { key: 'KOSPI', symbol: '^KS11', label: 'KOSPI' },
  { key: 'DXY', symbol: 'DX-Y.NYB', label: 'Dollar index' },
  { key: 'US10Y', symbol: '^TNX', label: 'US 10y yield', unit: '%' },
  { key: 'VIX', symbol: '^VIX', label: 'VIX' },
  { key: 'SPY', symbol: 'SPY', label: 'SPY', unit: ' (overnight)' },
  { key: 'QQQ', symbol: 'QQQ', label: 'QQQ', unit: ' (overnight)' },
];

export interface OvernightQuote {
  key: string;
  label: string;
  unit?: string;
  proxy: boolean;
  /** Latest quote. */
  value: number;
  /** Prior-close to latest, in percent. Sign is the real quote's, not inverted. */
  changePct: number;
  /** One plain-English clause about what the move leans toward. */
  clause: string;
}

export interface OvernightData {
  quotes: OvernightQuote[];
  /** Instruments the fetch could not resolve. Named, never silently dropped. */
  missing: string[];
  /** Rows shaped for `aggregateOvernight` — leans already sign-corrected. */
  leanRows: OvernightRow[];
  at: string;
}

/**
 * Cached for two minutes.
 *
 * Longer than the context row's one minute because these markets move on a
 * slower clock overnight and the card is background context, not a live quote a
 * reader is trading against. Short enough that it is not visibly behind.
 */
const CACHE_SECONDS = 120;

export function getOvernight(): Promise<OvernightData> {
  return cached('macro:overnight', CACHE_SECONDS, async () => {
    const { series } = await fetchSparks(
      INSTRUMENTS.map((i) => i.symbol),
      // Short timeout: this is context beside the levels, and a slow global
      // feed must not hold up the page the reader came for.
      { timeoutMs: 6_000 },
    );

    const quotes: OvernightQuote[] = [];
    const missing: string[] = [];
    const leanRows: OvernightRow[] = [];

    for (const inst of INSTRUMENTS) {
      const spark = series.get(inst.symbol);
      const last = spark?.closes[spark.closes.length - 1];

      if (!spark || last === undefined || !(spark.previousClose > 0)) {
        missing.push(inst.label);
        continue;
      }

      const changePct = ((last - spark.previousClose) / spark.previousClose) * 100;
      // The lean sees the inverted change for a price-proxy; the display keeps
      // the real number.
      const leanChange = inst.invert ? -changePct : changePct;
      const leanRow: OvernightRow = { key: inst.key, changePct: leanChange };
      leanRows.push(leanRow);

      quotes.push({
        key: inst.key,
        label: inst.label,
        unit: inst.unit,
        proxy: Boolean(inst.proxy),
        value: last,
        changePct,
        clause: rowClause(leanRow, OVERNIGHT_FLAT_PCT),
      });
    }

    return { quotes, missing, leanRows, at: new Date().toISOString() };
  });
}
