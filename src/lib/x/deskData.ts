import 'server-only';

import { getGroupsSnapshot } from '../groups';
import { rankTickers } from '../groups/ranking';
import { marketToday } from '../time';
import { getPositioning } from '../positioning';
import { getSpotQuote } from '../spot';
import { readScanForDate } from '../news/store';
import { xLine } from '../news/view';
import { fetchCboeQuote } from './cboeQuote';
import { stalestIso } from './compose';
import type { DeskSnapshot, ScoredName } from './compose';

/**
 * Assemble the one snapshot every reworked X post is built from — the same
 * figures the /decision page shows for SPY.
 *
 * Each source is already cached (positioning behind its TTL, the group snapshot
 * behind its own, the news scan a stored read), so composing a post costs no
 * upstream requests of its own beyond the single compact SPY quote — which is
 * what carries the day change and the session range the fixed templates need.
 *
 * The SPY quote timestamp is the freshness clock: the runner skips the post
 * when it is older than 90 minutes. If the compact quote fails outright the
 * positioning spot and its quote date stand in, so a post can still go out with
 * the levels even when the light quote endpoint is down.
 */
export async function loadDeskSnapshot(now: Date = new Date()): Promise<DeskSnapshot> {
  const date = marketToday(now);
  const [positioning, groups, live, quote, scan] = await Promise.all([
    getPositioning(),
    getGroupsSnapshot().catch(() => null),
    getSpotQuote('SPY').catch(() => null),
    fetchCboeQuote('SPY').catch(() => null),
    readScanForDate(date).catch(() => null),
  ]);

  const s = positioning.summary;

  // The price the post quotes comes from the live spot (short cache) so an X
  // post never says "SPY at 773.40" off a chain snapshot that is half an hour
  // old. Day change and the session range come from the compact quote when it
  // has them — a pure Polygon options plan does not echo an underlying prev
  // close, so those fall back to the compact quote and then to zero/omitted.
  const spot = live?.price ?? quote?.price ?? s.spot;
  const changePct = quote?.changePct ?? live?.changePct ?? 0;
  const dayHigh = quote?.dayHigh ?? live?.dayHigh ?? null;
  const dayLow = quote?.dayLow ?? live?.dayLow ?? null;
  // Freshness is graded by whichever clock is oldest: the price (live spot, else
  // the compact quote) or the option-chain snapshot behind the levels. The live
  // spot is stamped now, so it never masks a stale chain — the chain governs.
  const priceIso = live?.asOfIso ?? quote?.quoteIso;

  const ranked = groups ? rankTickers(groups) : [];
  const strong: ScoredName[] = ranked.slice(0, 3).map((r) => ({ symbol: r.symbol, score: r.score }));
  const weak: ScoredName[] = ranked
    .slice(-2)
    .reverse()
    .map((r) => ({ symbol: r.symbol, score: r.score }));

  const story = scan?.top?.[0] ?? null;
  const headline = story ? xLine(story) : null;

  return {
    spot,
    changePct,
    dayHigh,
    dayLow,
    mood: s.regime === 'positive' ? 'calm' : 'wild',
    resistance: s.magnetAbove?.strike ?? null,
    support: s.magnetBelow?.strike ?? null,
    flip: s.flipLevel,
    strong,
    weak,
    headline,
    dataIso: stalestIso(priceIso, positioning.meta.quoteDateIso) ?? new Date().toISOString(),
  };
}
