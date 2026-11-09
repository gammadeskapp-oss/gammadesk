import 'server-only';

import { config } from '../config';
import { buildPositioning } from '../exposure';
import type { PositioningData, Summary } from '../types';
import { getSpotQuote } from '../spot';
import { formatAsOf } from '../time';
import { chooseSpot, feedDelay, formatDelay } from './candleBook';
import { feedContracts, spotFrom } from './gex';
import { mockSnapshot } from './mock';
import { tastySourceMode } from './mode';
import type { FeedSnapshot, TastySourceMode } from './types';

/**
 * The one entry point `/lab` reads the Tastytrade source through.
 *
 * `TASTY_SOURCE=live` reads dxLink; anything else — unset included — reads the
 * mock. Default-mock means a deploy with no Tastytrade credentials renders a
 * clearly-labelled synthetic page instead of an error, and going live is a
 * deliberate env change rather than a side effect of a key being present.
 *
 * Everything returned here is a finished number. No token, URL, raw event or
 * env value is on this object, and it is what the pages hand to components.
 *
 * Read fresh on every call: no cache sits in front of the price or the gamma.
 * The mock is regenerated from the clock; the live path reads the latest events
 * the socket holds.
 */

export { tastySourceMode };

export interface LiveGammaReading {
  mode: TastySourceMode;
  symbol: string;
  /**
   * Epoch ms of the market time the reading reflects: the underlying's last
   * trade time when the feed sends one (on a delayed feed that is ~15 min ago),
   * else when the newest event arrived.
   */
  asOfMs: number | null;
  /** Tastytrade's data level for the stream, e.g. `demo`; `mock` on the mock. */
  feedLevel: string | null;
  /** How far the feed's trades trail the clock, or null when unknown. */
  delayMs: number | null;
  /** True when the feed is not live: a demo level or trades > 2 min old. */
  delayed: boolean;
  /** `Tastytrade dxLink`, `Tastytrade dxLink · DELAYED 15 min`, or the mock label. */
  sourceLabel: string;
  /**
   * Where `spot` came from. `yahoo` only while the feed is delayed and a
   * fresh Yahoo price was available — see `chooseSpot`.
   */
  spotSource: 'tastytrade' | 'yahoo';
  /** `Oct 22, 2026, 14:05 ET` for server-rendered stamps. */
  asOfLabel: string | null;
  /** Underlying quote mid off the feed. */
  spot: number | null;
  /** `positioning.summary`, lifted out for the cards that only want the summary. */
  summary: Summary | null;
  /**
   * The whole reading in the public `PositioningData` shape, built by the
   * public `buildPositioning` from the feed's IV and open interest — see
   * `./gex`. Same dealer sign, unit (per 1% move), flip search and scope as
   * `/decision` and `/dashboard`.
   */
  positioning: PositioningData | null;
  /**
   * The same book weighted by today's option volume, for the levels panel's
   * "Today's activity" view. Null when the feed carries no option trades.
   */
  activity: PositioningData | null;
  error: string | null;
}

/**
 * Live (or mock) spot and gamma for `symbol`.
 *
 * `referencePrice` only anchors the mock's spot; without one the mock anchors on
 * the production spot quote. The live path ignores both.
 */
export async function getLiveGamma(symbol: string, referencePrice?: number | null): Promise<LiveGammaReading> {
  const mode = tastySourceMode();
  const upper = symbol.trim().toUpperCase();

  let snapshot;
  let error: string | null = null;
  if (mode === 'live') {
    try {
      // Imported lazily so a mock deploy never even loads the socket client.
      const { liveSnapshot } = await import('./dxlink');
      ({ snapshot, error } = await liveSnapshot(upper));
    } catch (e) {
      return {
        mode,
        symbol: upper,
        asOfMs: null,
        feedLevel: null,
        delayMs: null,
        delayed: false,
        sourceLabel: 'Tastytrade dxLink',
        spotSource: 'tastytrade',
        asOfLabel: null,
        spot: null,
        summary: null,
        positioning: null,
        activity: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  } else {
    // Anchor the mock on the production spot quote (Cboe) when it answers, so
    // mock levels land around the real price on the real chart. Still mock.
    const reference = referencePrice ?? (await getSpotQuote(upper).catch(() => null))?.price ?? null;
    snapshot = mockSnapshot(upper, Date.now(), reference);
  }

  const underlying = snapshot.states.get(upper);
  const feedSpot = spotFrom(underlying);
  const now = Date.now();
  const tradeMs = underlying?.trade?.time;
  let feedLevel: string | null = 'mock';
  if (mode === 'live') {
    const { getStreamerLevel } = await import('./tokens');
    feedLevel = getStreamerLevel();
  }
  const { delayMs, delayed } = mode === 'live' ? feedDelay(feedLevel, tradeMs, now) : { delayMs: null, delayed: false };

  // A delayed feed's spot is replaced by Yahoo's near-real-time price when one
  // is fresh, so the levels are measured against the market now.
  let yahoo = null;
  if (mode === 'live' && delayed) {
    const { fetchYahooSpot } = await import('./yahooSpot');
    yahoo = await fetchYahooSpot(upper);
  }
  const chosen = chooseSpot(feedSpot, delayed, yahoo, now);
  const spot = chosen.spot;
  const spotSource = chosen.source;

  // The market time the numbers reflect: Yahoo's quote time when spot is from
  // Yahoo; otherwise the feed's trade time (on a delayed feed ~15 min ago, so the
  // stamp never passes old prices off as now).
  const feedTimeMs =
    typeof tradeMs === 'number' && Number.isFinite(tradeMs) && tradeMs > 0 ? tradeMs : (underlying?.receivedAt ?? null);
  const asOfMs = spotSource === 'yahoo' ? chosen.timeMs : feedTimeMs;
  const delayText = delayMs !== null ? formatDelay(delayMs) : '';
  const sourceLabel =
    mode === 'mock'
      ? 'Tastytrade (MOCK — not live)'
      : !delayed
        ? 'Tastytrade dxLink'
        : spotSource === 'yahoo'
          ? `spot Yahoo (live) · IV Tastytrade dxLink (delayed ${delayText})`.replace(' ()', '')
          : `Tastytrade dxLink · DELAYED ${delayText}`.trim();
  const positioning = spot !== null && asOfMs ? toPositioning(snapshot, spot, sourceLabel, asOfMs, 'openInterest') : null;
  const activity = positioning && spot !== null && asOfMs ? toPositioning(snapshot, spot, sourceLabel, asOfMs, 'volume') : null;
  return {
    mode,
    symbol: upper,
    asOfMs,
    feedLevel,
    delayMs,
    delayed,
    sourceLabel,
    spotSource,
    asOfLabel: asOfMs ? formatAsOf(new Date(asOfMs)) : null,
    spot,
    summary: positioning?.summary ?? null,
    positioning,
    activity,
    error: positioning ? error : (error ?? 'No gamma could be built from the feed.'),
  };
}

/**
 * The feed reading through the public builder, with the public scope
 * (`config.expirationCount` expirations, `config.strikesEachSide` strikes each
 * side of spot) and the public rate and dividend inputs. `weightBy: 'volume'`
 * is the same pass `/decision` runs for its "Today's activity" view; it is
 * null when no subscribed option has traded, so the toggle reads unavailable
 * rather than empty.
 */
function toPositioning(
  snapshot: FeedSnapshot,
  spot: number,
  sourceLabel: string,
  asOfMs: number,
  weightBy: 'openInterest' | 'volume',
): PositioningData | null {
  const now = new Date(asOfMs);
  const contracts = feedContracts(snapshot, now);
  if (contracts.length === 0) return null;
  if (weightBy === 'volume' && !contracts.some((c) => c.volume > 0)) return null;

  const label = formatAsOf(now);
  return buildPositioning(contracts, {
    symbol: snapshot.underlying,
    spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount: config.expirationCount,
    strikesEachSide: config.strikesEachSide,
    weightBy,
    meta: {
      source: 'tastytrade',
      sourceLabel,
      asOfLabel: label,
      asOfIso: now.toISOString(),
      quoteDateLabel: label,
      quoteDateIso: now.toISOString(),
      cacheSeconds: 0,
      upstreamRequests: 0,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      notes: [
        `${sourceLabel}: IV from the feed's Greeks events, open interest from its Summary events, spot from its quote. GEX, vanna, charm and the flip are the public model (dealer long calls / short puts, per 1% move), so a strike here is directly comparable to the same strike on /decision.`,
      ],
    },
  });
}
