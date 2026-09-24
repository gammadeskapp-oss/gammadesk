import 'server-only';

import { getGroupsSnapshot } from '../groups';
import { rankTickers } from '../groups/ranking';
import { marketToday } from '../time';
import { getPositioning } from '../positioning';
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
  const [positioning, groups, quote, scan] = await Promise.all([
    getPositioning(),
    getGroupsSnapshot().catch(() => null),
    fetchCboeQuote('SPY').catch(() => null),
    readScanForDate(date).catch(() => null),
  ]);

  const s = positioning.summary;

  const ranked = groups ? rankTickers(groups) : [];
  const strong: ScoredName[] = ranked.slice(0, 3).map((r) => ({ symbol: r.symbol, score: r.score }));
  const weak: ScoredName[] = ranked
    .slice(-2)
    .reverse()
    .map((r) => ({ symbol: r.symbol, score: r.score }));

  const story = scan?.top?.[0] ?? null;
  const headline = story ? xLine(story) : null;

  return {
    spot: quote?.price ?? s.spot,
    changePct: quote?.changePct ?? 0,
    dayHigh: quote?.dayHigh ?? null,
    dayLow: quote?.dayLow ?? null,
    mood: s.regime === 'positive' ? 'calm' : 'wild',
    resistance: s.magnetAbove?.strike ?? null,
    support: s.magnetBelow?.strike ?? null,
    flip: s.flipLevel,
    strong,
    weak,
    headline,
    // Freshness is judged by whichever feed is oldest: the compact SPY quote
    // (spot, day change) or the option-chain snapshot (the levels). A fresh
    // quote must not carry stale levels past the 90-minute gate.
    dataIso: stalestIso(quote?.quoteIso, positioning.meta.quoteDateIso) ?? new Date().toISOString(),
  };
}
