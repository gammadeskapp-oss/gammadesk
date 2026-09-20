/**
 * Pure parsing helpers shared by the source adapters: pulling a ticker out of an
 * EDGAR display name, building a filing URL, and extracting items from an RSS or
 * Atom feed. No IO and no `server-only`, so `scripts/verify-news.mjs` can drive
 * the fiddly bits — the parts most likely to break silently on a feed-format
 * change — without a network.
 */

import { normTicker } from './universe';

/** Pull the ticker out of "APPLE INC. (AAPL) (CIK 0000320193)" → {company, ticker}. */
export function parseDisplayName(display: string): { company: string; ticker: string | null } {
  const raw = (display || '').trim();
  const groups = [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  let ticker: string | null = null;
  for (const g of groups) {
    if (/^CIK\s/i.test(g)) continue;
    if (/^[A-Z][A-Z0-9]{0,6}([.\-][A-Z]{1,2})?$/.test(g)) {
      ticker = normTicker(g);
      break;
    }
  }
  const company = raw.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return { company, ticker };
}

/** Build the canonical filing-index URL from an accession number and CIK. */
export function filingUrl(adsh: string | undefined, cik: string | undefined): string {
  if (!adsh) return 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K';
  const noDash = adsh.replace(/-/g, '');
  const cikNum = cik ? Number(cik) : NaN;
  if (!Number.isFinite(cikNum)) {
    return 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K';
  }
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${noDash}/${adsh}-index.htm`;
}

/** A very small RSS/Atom item extractor — title, link, date — no dependency. */
export function parseFeedItems(xml: string): Array<{ title: string; link: string; date: string }> {
  const items: Array<{ title: string; link: string; date: string }> = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = decodeXml(pick(block, 'title'));
    const date = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || '';
    let link = decodeXml(pick(block, 'link'));
    if (!link) {
      const href = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      link = href ? href[1] : '';
    }
    if (title) items.push({ title, link, date });
  }
  return items;
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Find a ticker mentioned in a press-release title. Wires commonly write
 * "(NASDAQ: AAPL)"; failing that, any bare token in the universe set. Returns
 * the first universe match, or null.
 */
export function tickerFromTitle(title: string, tickers: Set<string>): string | null {
  const paren = title.match(/\((?:NASDAQ|NYSE|NYSEAMERICAN|AMEX|OTC)[:\s]+([A-Z.\-]{1,8})\)/i);
  if (paren) {
    const t = normTicker(paren[1]);
    if (tickers.has(t)) return t;
  }
  for (const token of title.toUpperCase().match(/\b[A-Z]{1,6}\b/g) ?? []) {
    if (tickers.has(token)) return token;
  }
  return null;
}
