import 'server-only';

import { eventsWithin } from '../merge';
import { fetchJson, errorMessage } from '../http';
import type { SourceResult } from '../store';
import { parseTreasuryAuctions } from './treasuryParse';

/**
 * Fetch upcoming Treasury auctions and parse them to the window.
 *
 * The documented JSON endpoint returns announced and recently auctioned
 * securities; we keep the ones whose auction date falls in the window. A
 * non-200 or malformed body fails the source for this run and the store keeps
 * the last good fetch.
 */

const API_URL = 'https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json';
const HUMAN_URL = 'https://www.treasurydirect.gov/auctions/upcoming/';

export async function fetchTreasuryAuctions(
  range: { from: string; to: string },
): Promise<SourceResult> {
  try {
    const json = await fetchJson(API_URL);
    const parsed = parseTreasuryAuctions(json, { sourceUrl: HUMAN_URL });
    return { ok: true, events: eventsWithin(parsed, range.from, range.to) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
