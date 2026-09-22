import 'server-only';

import { cleanFilingText } from './extract';

/**
 * Fetch the real text of an EDGAR 8-K so the scanner can write a specific
 * headline instead of a category template.
 *
 * Only EDGAR filings are fetched here: they are public-domain, so their text may
 * be read and the facts surfaced (the headline is still rewritten in our own
 * words downstream). A wire or press-release *title* is copyrighted and has no
 * fetchable public-domain body, so those sources stay corroboration-only and
 * are never enriched or surfaced on their own.
 *
 * Given a filing's `-index.htm` URL, this finds the primary 8-K document and any
 * EX-99 press-release exhibit, fetches them, strips them to plain text and
 * returns a bounded blob for the extractor. Never throws — resolves to `null`
 * on any failure so the scan carries on and simply drops the item.
 */

const ORIGIN = 'https://www.sec.gov';
const MAX_CHARS = 40_000;

function contactEmail(): string {
  return (process.env.NEWS_CONTACT_EMAIL ?? 'alertbox1725@gmail.com').trim();
}

function userAgent(): string {
  return `GammaDesk news scanner (${contactEmail()})`;
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent(), Accept: 'text/html,application/xhtml+xml,text/plain' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function resolve(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return `${ORIGIN}${href}`;
  return `${ORIGIN}/${href}`;
}

/**
 * Order the documents so the richest text is read first and the cap is spent
 * well: the EX-99 press release (real detail) first, then the primary 8-K body,
 * and never the index page or obvious non-content files.
 */
function prioritise(urls: string[]): string[] {
  const isEx99 = (u: string) => /ex[-_ ]?99/i.test(u);
  const junk = (u: string) => /-index\.htm|\bR\d+\.htm|FilingSummary|\.jpg|\.png|\.gif|\.css|\.js$/i.test(u);
  return urls
    .filter((u) => !junk(u))
    .sort((a, b) => Number(isEx99(b)) - Number(isEx99(a)));
}

/**
 * The plain text of a filing, from its `-index.htm` URL. Returns null when the
 * filing has no fetchable index (e.g. the URL fell back to a browse-edgar link)
 * or nothing readable could be pulled.
 */
export async function fetchFilingText(indexUrl: string): Promise<string | null> {
  if (!/\/Archives\/edgar\/data\/.+-index\.htm$/i.test(indexUrl)) return null;

  const index = await getText(indexUrl);
  if (!index) return null;

  const hrefs = [...index.matchAll(/href="([^"]+?\.(?:htm|html|txt))"/gi)].map((m) => m[1]);
  const folder = indexUrl.replace(/[^/]*$/, '');
  const docs = [
    ...new Set(
      hrefs
        .map(resolve)
        // Keep only documents inside this accession's own folder.
        .filter((u) => u.startsWith(folder) && u !== indexUrl),
    ),
  ];

  let combined = '';
  for (const url of prioritise(docs).slice(0, 3)) {
    const html = await getText(url);
    if (!html) continue;
    combined += ` ${cleanFilingText(html)}`;
    if (combined.length >= MAX_CHARS) break;
    await new Promise((r) => setTimeout(r, 120)); // gentle on the SEC.
  }

  const text = combined.trim().slice(0, MAX_CHARS);
  return text.length >= 40 ? text : null;
}
