import 'server-only';

import { marketToday } from '../time';
import { fetchEdgar8K } from './edgar';
import { extractStory } from './extract';
import { fetchFilingText } from './fetchFiling';
import { isHealthcare, shortName } from './industry';
import { fetchPolygonNews } from './polygon';
import { fetchPress } from './press';
import { rankItems } from './scan-core';
import { scanTickers, watchlist } from './universe';
import type { NewsScanResult, RawItem, SourceReport } from './types';

/**
 * Read the real text of each EDGAR filing and attach the specific story it
 * yields. Bounded concurrency keeps us polite to the SEC. An item whose text
 * cannot be fetched or understood is left un-enriched, so the ranker drops it
 * rather than showing a vague headline.
 */
async function enrichEdgar(items: RawItem[], maxFetches = 12): Promise<void> {
  const queue = items.filter((it) => it.source === 'edgar').slice(0, maxFetches);
  const workers = 4;
  let cursor = 0;
  async function work(): Promise<void> {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const text = await fetchFilingText(item.url);
      if (!text) continue;
      const company = shortName(item.company, item.ticker);
      const story = extractStory({
        text,
        itemCodes: item.signals.itemCodes ?? [],
        itemCategory: item.category,
        company,
        ticker: item.ticker,
        isHealthcare: isHealthcare(item.ticker),
      });
      if (story) {
        item.enrichment = { headline: story.headline, why: story.why, category: story.category, company, magnitude: story.magnitude };
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, work));
}

/**
 * Run one full scan: gather from every source, rank, and return the day's
 * result. Each source is isolated — a failure is caught, recorded in the
 * `sources` report, and never blocks the others or the whole scan, exactly as
 * the brief requires ("if a source fails, skip it and log it").
 *
 * This does not persist anything; the route decides whether to store, so a
 * `?dry=1` preview can run the real pipeline without writing.
 */
export async function runScan(now: Date = new Date()): Promise<NewsScanResult> {
  const tickers = scanTickers();
  const watch = new Set(watchlist());
  const reports: SourceReport[] = [];
  const all: RawItem[] = [];

  // Primary — SEC EDGAR 8-Ks. Never throws (returns [] on failure).
  try {
    const edgar = await fetchEdgar8K(tickers, { now });
    all.push(...edgar);
    reports.push({ source: 'edgar', ok: true, count: edgar.length });
  } catch (error) {
    reports.push({ source: 'edgar', ok: false, count: 0, note: message(error) });
  }

  // Secondary — Polygon news, only if the plan includes it.
  try {
    const poly = await fetchPolygonNews(tickers);
    all.push(...poly.items);
    reports.push({ source: 'polygon', ok: poly.ok, count: poly.items.length, note: poly.note });
  } catch (error) {
    reports.push({ source: 'polygon', ok: false, count: 0, note: message(error) });
  }

  // Tertiary — configured press-release feeds.
  try {
    const press = await fetchPress(tickers);
    all.push(...press.items);
    reports.push({ source: 'press', ok: press.ok, count: press.items.length, note: press.note });
  } catch (error) {
    reports.push({ source: 'press', ok: false, count: 0, note: message(error) });
  }

  // Read the real filing text for the EDGAR candidates and attach the specific
  // story. Only enriched items are surfaced; the rest still corroborate.
  await enrichEdgar(all);

  const { top, ranked } = rankItems(all, watch);

  return {
    date: marketToday(now),
    scannedAt: now.toISOString(),
    top,
    ranked,
    sources: reports,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
