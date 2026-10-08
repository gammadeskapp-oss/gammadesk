/**
 * The TreasuryDirect auctions parser — pure, fixture-driven (see `../types.ts`).
 *
 * ## What it reads
 *
 * The public TreasuryDirect securities API, e.g.
 * `https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json`, which
 * returns one record per auctioned/announced security. This is a documented
 * JSON endpoint (not a scrape), so it is the sturdier of the two feeds.
 *
 * ## Time of day
 *
 * The API gives the auction *date* but not a reliable wall-clock time, and the
 * schedule is fixed: notes and bonds auction at 1:00 p.m. ET, bills at
 * 11:30 a.m. ET. Those are applied as the standard times rather than invented
 * per record — the one honest assumption the feed makes, documented here.
 */

import {
  buildFetchedEvent,
  treasuryAuctionImportance,
  type FetchedEvent,
} from '../types';

/** The term in whole years, or null for bills and other sub-year paper. */
export function termYears(securityTerm: string): number | null {
  const m = /(\d+)\s*-?\s*year/i.exec(securityTerm);
  return m ? Number(m[1]) : null;
}

interface TreasuryRecord {
  securityType?: string;
  securityTerm?: string;
  auctionDate?: string;
}

/** The standard auction wall clock (ET) for a security type. */
function standardTimeEt(securityType: string): string {
  return securityType.toLowerCase().includes('bill') ? '11:30' : '13:00';
}

/**
 * Parse TreasuryDirect records into fetched auction events. Records without an
 * auction date or a recognised security type are dropped. The caller trims to
 * the window it wants and de-duplicates reopenings by date+name.
 */
export function parseTreasuryAuctions(
  raw: unknown,
  opts: { sourceUrl: string },
): FetchedEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: FetchedEvent[] = [];

  for (const rec of raw as TreasuryRecord[]) {
    const securityType = (rec?.securityType ?? '').trim();
    const securityTerm = (rec?.securityTerm ?? '').trim();
    const date = (rec?.auctionDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !securityType) continue;

    const years = termYears(securityTerm);
    const name = `${securityTerm} ${securityType} auction`.replace(/\s+/g, ' ').trim();

    events.push(
      buildFetchedEvent({
        date,
        timeEt: standardTimeEt(securityType),
        name,
        importance: treasuryAuctionImportance(securityType, years),
        source: 'treasury',
        sourceUrl: opts.sourceUrl,
        topic: 'Treasury auction',
      }),
    );
  }

  return events;
}
