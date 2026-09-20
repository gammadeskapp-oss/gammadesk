import 'server-only';

import { config } from '../config';
import { categoryForKeywords } from './score';
import { normTicker } from './universe';
import type { RawItem } from './types';

/**
 * The secondary source: Polygon's news wire.
 *
 * ## Whether it is used at all
 *
 * The brief says to use Polygon news only if the configured plan already
 * includes it — never to add a paid plan for it. The free/entitlement check is
 * simply "is there an API key, and does the news endpoint answer 200". If the
 * key is missing or the endpoint refuses, this source is skipped and the scan
 * carries on with EDGAR and the press feeds; `available()` reports which.
 *
 * ## Copyright
 *
 * A wire headline is copyrighted, so it is never stored or shown. Polygon is
 * used two ways only: as a *corroborating signal* (a second, independent feed
 * naming a ticker the same day nudges its score) and to classify a story into a
 * category by keyword. The stored headline is always generated in our own words
 * from that category — the source's own title never leaves this module.
 */

const NEWS_URL = 'https://api.polygon.io/v2/reference/news';

export function hasKey(): boolean {
  return Boolean(config.apiKey);
}

/**
 * Fetch recent wire items and normalise them, filtered to our tickers. Never
 * throws. Returns `{ ok, items, note }` so the orchestrator can record the
 * source outcome even when the plan does not include news.
 */
export async function fetchPolygonNews(
  tickers: Set<string>,
  opts: { limit?: number } = {},
): Promise<{ ok: boolean; items: RawItem[]; note?: string }> {
  const key = config.apiKey;
  if (!key) {
    return { ok: false, items: [], note: 'No Polygon API key configured; secondary source skipped.' };
  }
  const limit = Math.min(1000, Math.max(10, opts.limit ?? 200));
  const url = `${NEWS_URL}?order=desc&sort=published_utc&limit=${limit}&apiKey=${encodeURIComponent(key)}`;

  let results: PolygonNews[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (res.status === 403) {
      return { ok: false, items: [], note: 'Polygon plan does not include news; secondary source skipped.' };
    }
    if (!res.ok) {
      return { ok: false, items: [], note: `Polygon news returned HTTP ${res.status}.` };
    }
    const json = (await res.json()) as { results?: PolygonNews[] };
    results = json.results ?? [];
  } catch (error) {
    return {
      ok: false,
      items: [],
      note: `Polygon news request failed: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  const out: RawItem[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const symbols = (r.tickers ?? []).map((t) => normTicker(t)).filter((t) => tickers.has(t));
    if (symbols.length === 0) continue;
    const ticker = symbols[0];
    // One item per ticker per scan is enough — the wire repeats the same story
    // across many outlets, and we only want the corroboration signal once.
    if (seen.has(ticker)) continue;
    seen.add(ticker);

    // Classify by keyword only. The title is read here and then discarded; it is
    // never stored, so nothing copyrighted leaves this function.
    const category = categoryForKeywords(`${r.title ?? ''} ${r.description ?? ''}`);
    out.push({
      source: 'polygon',
      ticker,
      company: ticker, // EDGAR carries the proper issuer name; the wire has none.
      category,
      timestamp: r.published_utc ?? new Date().toISOString(),
      url: r.article_url ?? 'https://polygon.io',
      signals: { keywords: [] },
    });
  }

  return { ok: true, items: out };
}

interface PolygonNews {
  title?: string;
  description?: string;
  published_utc?: string;
  article_url?: string;
  tickers?: string[];
}
