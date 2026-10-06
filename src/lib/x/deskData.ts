import 'server-only';

import { getBreadth, isRegularHours } from '../breadth';
import { isSpyRspStale, spyRspPostLine } from '../breadth/spyRsp';
import { getGroupsSnapshot } from '../groups';
import { moverSymbols } from '../groups/definitions';
import { rankTickers } from '../groups/ranking';
import { marketToday } from '../time';
import { getPositioning } from '../positioning';
import { getSpotQuote } from '../spot';
import { readScanForDate } from '../news/store';
import { xLine } from '../news/view';
import { fetchCboeQuote, fetchCboeQuotes } from './cboeQuote';
import { stalestIso } from './compose';
import type { DayMover, DeskSnapshot, ScoredName } from './compose';

/**
 * Today's top gainers and losers across the tracked single stocks, by live day
 * change. Fetched from the same Cboe compact-quote feed the pulse uses, so the
 * percentages are the actual intraday moves — not the multi-day strength score
 * behind `strong`/`weak`. Two of each; a name with no finite change is skipped.
 */
async function loadDayMovers(): Promise<{ gainers: DayMover[]; losers: DayMover[] }> {
  const quotes = await fetchCboeQuotes(moverSymbols()).catch(() => new Map());
  const rows: DayMover[] = [...quotes.values()]
    .filter((q) => Number.isFinite(q.changePct))
    .map((q) => ({ symbol: q.symbol, changePct: q.changePct }));

  const gainers = rows
    .filter((r) => r.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 2);
  const losers = rows
    .filter((r) => r.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 2);

  return { gainers, losers };
}

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
  const [positioning, groups, live, quote, scan, movers, breadth] = await Promise.all([
    getPositioning(),
    getGroupsSnapshot().catch(() => null),
    getSpotQuote('SPY').catch(() => null),
    fetchCboeQuote('SPY').catch(() => null),
    readScanForDate(date).catch(() => null),
    loadDayMovers().catch(() => ({ gainers: [], losers: [] })),
    getBreadth().catch(() => null),
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

  // The SPY-vs-RSP line, only when the reading is fresh — a stale one is left
  // off the post rather than quoted as if it were today's.
  const sr = breadth?.spyRsp ?? null;
  const spyRspFresh = sr && !isSpyRspStale(sr, { marketOpen: isRegularHours(now), now }) ? sr : null;
  const spyRspLine = spyRspFresh ? spyRspPostLine(spyRspFresh) : null;

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
    gainers: movers.gainers,
    losers: movers.losers,
    headline,
    spyRspLine,
    spyRspVerdict: spyRspFresh ? spyRspFresh.verdict : null,
    spyRspVerdictText: spyRspFresh ? spyRspFresh.line : null,
    dataIso: stalestIso(priceIso, positioning.meta.quoteDateIso) ?? new Date().toISOString(),
  };
}

/**
 * Compute the desk snapshot together with the source that served the chain,
 * ready to persist for the tick to read. Only the `/api/x/snapshot` cron calls
 * this — it is the one place that pays the full chain-fetch + IV-surface cost.
 *
 * `getPositioning()` is cached in-process, so the second call here is a cache
 * hit off the fetch `loadDeskSnapshot` just made — it reads the source label
 * without a second upstream request.
 */
export async function computeDeskSnapshotForCache(
  now: Date = new Date(),
): Promise<{ snapshot: DeskSnapshot; source: 'cboe' | 'polygon'; builtAtIso: string }> {
  const snapshot = await loadDeskSnapshot(now);
  const positioning = await getPositioning();
  return { snapshot, source: positioning.meta.source, builtAtIso: new Date().toISOString() };
}
