import 'server-only';

import { categoryForKeywords } from './score';
import { parseFeedItems, tickerFromTitle } from './parse';
import type { RawItem } from './types';

/**
 * The tertiary source: company / market press-release RSS feeds.
 *
 * ## Why it is configurable rather than 50 hard-coded feeds
 *
 * There is no single free, stable RSS endpoint that covers "the top 50 names by
 * market cap" — each issuer publishes through a different wire (GlobeNewswire,
 * Business Wire, PR Newswire) under a different feed URL, and those URLs change.
 * So the feed list is data, not code: set `NEWS_PRESS_FEEDS` to a comma or
 * newline separated list of RSS URLs (a company IR feed, or a wire's per-company
 * feed) and the scanner reads them. With none configured this source simply
 * contributes nothing and reports so — it never blocks the scan.
 *
 * ## Copyright
 *
 * As with the wire, a press-release title is copyrighted. The title is read only
 * to (a) find a ticker and (b) classify a category by keyword, then discarded.
 * The stored headline is generated in our own words; only the link is kept.
 */

function feeds(): string[] {
  const raw = process.env.NEWS_PRESS_FEEDS ?? '';
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/**
 * Fetch and normalise every configured press feed, filtered to our tickers.
 * Never throws; a single bad feed is skipped, not fatal.
 */
export async function fetchPress(
  tickers: Set<string>,
): Promise<{ ok: boolean; items: RawItem[]; note?: string }> {
  const urls = feeds();
  if (urls.length === 0) {
    return { ok: true, items: [], note: 'No NEWS_PRESS_FEEDS configured; no press feeds read.' };
  }

  const out: RawItem[] = [];
  const seen = new Set<string>();
  let anyOk = false;
  const failures: string[] = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'GammaDesk news scanner', Accept: 'application/rss+xml, application/xml, text/xml' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          failures.push(`${host(url)} HTTP ${res.status}`);
          return;
        }
        anyOk = true;
        const xml = await res.text();
        for (const item of parseFeedItems(xml)) {
          const ticker = tickerFromTitle(item.title, tickers);
          if (!ticker) continue;
          const key = `${ticker}:${item.link || item.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            source: 'press',
            ticker,
            company: ticker,
            category: categoryForKeywords(item.title),
            timestamp: toIso(item.date),
            url: item.link || url,
            signals: { keywords: [] },
          });
        }
      } catch (error) {
        failures.push(`${host(url)} ${error instanceof Error ? error.message : 'failed'}`);
      }
    }),
  );

  return {
    ok: anyOk || urls.length === 0,
    items: out,
    note: failures.length ? `Some press feeds failed: ${failures.join('; ')}.` : undefined,
  };
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}

function toIso(date: string): string {
  const t = Date.parse(date);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}
