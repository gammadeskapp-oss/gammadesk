import 'server-only';

import { categoryForItems } from './headline';
import { filingUrl, parseDisplayName } from './parse';
import type { RawItem } from './types';

/**
 * The primary source: SEC EDGAR 8-K current reports, via the full-text search
 * index API (`efts.sec.gov`).
 *
 * ## Why this endpoint
 *
 * The search index returns, for every matching filing, the SEC's own structured
 * `items` codes and the issuer's `display_names` (which include the ticker when
 * the filer is listed). That is a far cleaner signal than scraping filing prose:
 * the item code *is* the classification, so scoring never touches copyrighted
 * text. Filtering `forms=8-K` with a date range and no query term returns every
 * recent 8-K, newest first, 100 per page.
 *
 * ## Manners
 *
 * The SEC requires a descriptive User-Agent that identifies the caller with a
 * contact email, and asks for no more than 10 requests a second. We send a
 * proper UA (the owner's contact address, overridable via `NEWS_CONTACT_EMAIL`),
 * page a small number of times, and pause briefly between pages — well within
 * the limit. Public-domain filings, so the link and the facts may be surfaced;
 * the headline is still generated in our own words downstream.
 */

const FTS_URL = 'https://efts.sec.gov/LATEST/search-index';
const PAGE_SIZE = 100;

function contactEmail(): string {
  return (process.env.NEWS_CONTACT_EMAIL ?? 'alertbox1725@gmail.com').trim();
}

function userAgent(): string {
  return `GammaDesk news scanner (${contactEmail()})`;
}

/** `YYYY-MM-DD` for `daysAgo` days before `now`, in UTC (date-only, so exact TZ
 * does not matter for a day-granularity filing feed). */
function isoDate(now: Date, daysAgo: number): string {
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

interface FtsSource {
  items?: string[];
  display_names?: string[];
  file_date?: string;
  form?: string;
  adsh?: string;
  ciks?: string[];
}

/**
 * Fetch recent 8-K filings and normalise them into `RawItem`s, filtered to the
 * tickers we care about. Never throws: on any failure it resolves to an empty
 * list so the orchestrator can record the source as failed and carry on.
 *
 * @param tickers  The universe ∪ watchlist set to keep.
 * @param opts.lookbackDays  How many calendar days back to include (default 2,
 *   so an early-morning scan still sees the previous afternoon's filings).
 * @param opts.maxPages  How many 100-row pages to page through (default 3).
 */
export async function fetchEdgar8K(
  tickers: Set<string>,
  opts: { now?: Date; lookbackDays?: number; maxPages?: number } = {},
): Promise<RawItem[]> {
  const now = opts.now ?? new Date();
  const lookback = opts.lookbackDays ?? 2;
  const maxPages = Math.max(1, opts.maxPages ?? 3);
  const startdt = isoDate(now, lookback);
  const enddt = isoDate(now, 0);

  const out: RawItem[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * PAGE_SIZE;
    const url = `${FTS_URL}?forms=8-K&startdt=${startdt}&enddt=${enddt}&from=${from}`;
    let hits: Array<{ _source?: FtsSource }> = [];
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) break;
      const json = (await res.json()) as { hits?: { hits?: Array<{ _source?: FtsSource }> } };
      hits = json.hits?.hits ?? [];
    } catch {
      break; // network/timeout/parse — stop paging, return what we have.
    }
    if (hits.length === 0) break;

    for (const hit of hits) {
      const src = hit._source;
      if (!src) continue;
      const display = src.display_names?.[0] ?? '';
      const { company, ticker } = parseDisplayName(display);
      if (!ticker || !tickers.has(ticker)) continue;
      const adsh = src.adsh ?? '';
      if (adsh && seen.has(adsh)) continue;
      if (adsh) seen.add(adsh);

      const items = (src.items ?? []).map((i) => String(i).trim()).filter(Boolean);
      const category = categoryForItems(items);
      out.push({
        source: 'edgar',
        ticker,
        company,
        category,
        timestamp: toIso(src.file_date),
        url: filingUrl(adsh, src.ciks?.[0]),
        signals: { itemCodes: items },
      });
    }

    if (hits.length < PAGE_SIZE) break;
    // Gentle pacing between pages — comfortably under the SEC's 10 req/s.
    await sleep(150);
  }

  return out;
}

function toIso(fileDate: string | undefined): string {
  if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    // Filing dates are date-only; stamp them at the close-ish hour in UTC so the
    // relative-time label reads sensibly without implying a precise minute.
    return `${fileDate}T20:00:00Z`;
  }
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
