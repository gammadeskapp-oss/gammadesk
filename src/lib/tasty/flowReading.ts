import 'server-only';

import { daysToExpiry, formatAsOf, isExpired, marketNow } from '../time';
import { feedDelay } from './candleBook';
import {
  computeFlow,
  contractFlow,
  HEADLINE_MAX_DTE,
  NEAR_MONEY_PCT,
  type FlowContract,
  type FlowResult,
  type FlowTally,
} from './flow';
import { spotFrom } from './gex';
import { mockSnapshot } from './mock';
import { tastySourceMode } from './mode';
import type { OptionRef, SymbolState, TastySourceMode } from './types';

/**
 * The put/call flow reading `/lab` shows, as plain numbers for the client.
 *
 * `status`:
 * - `ok` — the headline scope is (nearly) fully loaded and the socket is alive.
 * - `loading` — the socket is alive but the chain is still subscribing (dxLink
 *   rate-limits subscriptions); no headline number is printed off a partial
 *   book, because a partial book is exactly the junk ratio this avoids.
 * - `down` — no usable feed: socket silent, chain unreadable, no spot. The
 *   panel shows a red banner and never a number from this reading.
 */
export interface LiveFlowReading {
  mode: TastySourceMode;
  symbol: string;
  status: 'ok' | 'loading' | 'down';
  spot: number | null;
  /** Market time of the newest option trade in the chain (epoch ms). */
  asOfMs: number | null;
  asOfLabel: string | null;
  /** When this reading was computed on the server (epoch ms). */
  computedAtMs: number;
  delayed: boolean;
  delayMs: number | null;
  feedLevel: string | null;
  sourceLabel: string;
  marketOpen: boolean;
  /** Contracts with Trade + Greeks + Summary in, of those listed, per scope. */
  coverage: { near: { have: number; total: number }; wide: { have: number; total: number }; queued: number; refused: number };
  /** Whether each scope is complete enough to print. */
  ready: { near: boolean; wide: boolean };
  result: FlowResult | null;
  error: string | null;
}

/** A scope prints once this share of its contracts has every event in. */
const READY_SHARE = 0.95;
/** No frame at all from dxLink for this long (it keepalives every 30 s) means the socket is gone. */
const SILENT_DOWN_MS = 75_000;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isMarketOpen(now: Date): boolean {
  const { weekday, hour, minute } = marketNow(now);
  if (weekday === 0 || weekday === 6) return false;
  const m = hour * 60 + minute;
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

interface Built {
  contracts: FlowContract[];
  coverage: LiveFlowReading['coverage'];
  newestTradeMs: number | null;
}

/** Feed state → per-contract flow inputs and coverage. */
function build(
  refs: OptionRef[],
  states: Map<string, SymbolState>,
  tally: (symbol: string, state: SymbolState) => FlowTally | undefined,
  spot: number,
  now: Date,
  queued: number,
  refused: number,
): Built {
  const contracts: FlowContract[] = [];
  let nearHave = 0;
  let nearTotal = 0;
  let fullHave = 0;
  let fullTotal = 0;
  let newest: number | null = null;
  for (const ref of refs) {
    if (isExpired(ref.expiration, now)) continue;
    const near =
      Math.abs(ref.strike - spot) / spot <= NEAR_MONEY_PCT && daysToExpiry(ref.expiration, now) <= HEADLINE_MAX_DTE;
    fullTotal += 1;
    if (near) nearTotal += 1;
    const state = states.get(ref.streamerSymbol);
    const trade = state?.trade;
    const delta = state?.greeks?.delta;
    const complete = Boolean(trade && state?.greeks && state?.summary);
    if (complete) {
      fullHave += 1;
      if (near) nearHave += 1;
    }
    if (!state || !trade || !finite(trade.dayVolume)) continue;
    if (finite(trade.time) && trade.time > 0 && trade.dayVolume > 0) newest = Math.max(newest ?? 0, trade.time);
    const t = tally(ref.streamerSymbol, state);
    if (!t) continue;
    const oi = state.summary?.openInterest;
    contracts.push({
      type: ref.type,
      strike: ref.strike,
      expiration: ref.expiration,
      ...contractFlow(t, finite(delta) ? delta : null),
      openInterest: finite(oi) && oi >= 0 ? oi : null,
    });
  }
  return {
    contracts,
    coverage: { near: { have: nearHave, total: nearTotal }, wide: { have: fullHave, total: fullTotal }, queued, refused },
    newestTradeMs: newest !== null ? Math.min(newest, now.getTime()) : null,
  };
}

function down(mode: TastySourceMode, symbol: string, error: string, extra: Partial<LiveFlowReading> = {}): LiveFlowReading {
  const now = Date.now();
  return {
    mode,
    symbol,
    status: 'down',
    spot: null,
    asOfMs: null,
    asOfLabel: null,
    computedAtMs: now,
    delayed: false,
    delayMs: null,
    feedLevel: null,
    sourceLabel: 'Tastytrade dxLink',
    marketOpen: isMarketOpen(new Date(now)),
    coverage: { near: { have: 0, total: 0 }, wide: { have: 0, total: 0 }, queued: 0, refused: 0 },
    ready: { near: false, wide: false },
    result: null,
    error,
    ...extra,
  };
}

/** Live (or mock) put/call flow for `symbol`. Read fresh on every call. */
export async function getLiveFlow(symbol: string): Promise<LiveFlowReading> {
  const mode = tastySourceMode();
  const upper = symbol.trim().toUpperCase();
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const marketOpen = isMarketOpen(now);

  if (mode === 'mock') {
    // Lazily, so the live path never loads the public spot pipeline.
    const { getSpotQuote } = await import('../spot');
    const reference = (await getSpotQuote(upper).catch(() => null))?.price ?? null;
    const snap = mockSnapshot(upper, nowMs, reference);
    const spot = spotFrom(snap.states.get(upper));
    if (spot === null) return down(mode, upper, 'The mock produced no spot.', { sourceLabel: 'Tastytrade (MOCK — not live)' });
    // The mock has no tape: it pretends the whole day was watched from the open,
    // every contract at its current (mock) delta.
    const openMs = nowMs - 90 * 60_000;
    const built = build(
      snap.options,
      snap.states,
      (_s, state) => {
        const d = state.greeks?.delta;
        const v = state.trade?.dayVolume ?? 0;
        return { dayVolume: v, baseVolume: 0, watchedSince: openMs, liveDeltaVolume: finite(d) ? Math.abs(d) * v : 0, pending: 0 };
      },
      spot,
      now,
      0,
      0,
    );
    return {
      mode,
      symbol: upper,
      status: 'ok',
      spot,
      asOfMs: nowMs,
      asOfLabel: formatAsOf(now),
      computedAtMs: nowMs,
      delayed: false,
      delayMs: null,
      feedLevel: 'mock',
      sourceLabel: 'Tastytrade (MOCK — not live)',
      marketOpen,
      coverage: built.coverage,
      ready: { near: true, wide: true },
      result: computeFlow(built.contracts, spot, now),
      error: null,
    };
  }

  let feed;
  try {
    const { liveFlow } = await import('./dxlink');
    feed = await liveFlow(upper);
  } catch (e) {
    return down(mode, upper, e instanceof Error ? e.message : String(e));
  }

  const { getStreamerLevel } = await import('./tokens');
  const feedLevel = getStreamerLevel();
  const underlying = feed.states.get(upper);
  const spot = spotFrom(underlying);
  const silentMs = feed.lastMessageAt > 0 ? nowMs - feed.lastMessageAt : Number.POSITIVE_INFINITY;

  if (!feed.ready || silentMs > SILENT_DOWN_MS) {
    return down(
      mode,
      upper,
      feed.error ??
        (feed.lastMessageAt > 0
          ? `No frame from dxLink for ${Math.round(silentMs / 1000)}s — the socket is down or reconnecting.`
          : 'dxLink is not connected yet.'),
      { feedLevel },
    );
  }
  if (feed.refs.length === 0) return down(mode, upper, feed.error ?? `No option chain for ${upper}.`, { feedLevel });
  if (spot === null) return down(mode, upper, feed.error ?? 'No underlying quote from dxLink.', { feedLevel });

  // Outside the session the last trade is naturally old; only a demo level is "delayed" then.
  const { delayMs, delayed } = marketOpen
    ? feedDelay(feedLevel, underlying?.trade?.time, nowMs)
    : { delayMs: null, delayed: feedDelay(feedLevel, null, nowMs).delayed };
  const built = build(feed.refs, feed.states, (s) => feed.flow.get(s), spot, now, feed.queued, feed.refused);
  const ready = {
    near: built.coverage.near.total > 0 && built.coverage.near.have >= built.coverage.near.total * READY_SHARE,
    wide: built.coverage.wide.total > 0 && built.coverage.wide.have >= built.coverage.wide.total * READY_SHARE,
  };
  const asOfMs = built.newestTradeMs;
  return {
    mode,
    symbol: upper,
    status: ready.near ? 'ok' : 'loading',
    spot,
    asOfMs,
    asOfLabel: asOfMs ? formatAsOf(new Date(asOfMs)) : null,
    computedAtMs: nowMs,
    delayed,
    delayMs,
    feedLevel,
    sourceLabel: delayed ? 'Tastytrade dxLink · DELAYED' : 'Tastytrade dxLink',
    marketOpen,
    coverage: built.coverage,
    ready,
    result: computeFlow(built.contracts, spot, now),
    error: feed.error,
  };
}
