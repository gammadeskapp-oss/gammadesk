import { daysToExpiry, isExpired } from '../time';

/**
 * Put/call FLOW for `/lab`, computed from the dxLink events the feed already
 * streams (Trade, Greeks, Summary). Pure; no I/O.
 *
 * ## Three ratios, three meanings
 *
 * - **Delta-weighted (headline).** Every contract traded is weighted by the
 *   option's |delta| at the time it traded: a 0.50-delta put counts five times
 *   a 0.10-delta put. Sum the put side and the call side and divide. It reads
 *   how much directional exposure changed hands, not how many tickets printed.
 * - **Volume (traditional).** Put contracts ÷ call contracts, from each
 *   option's `dayVolume`. The familiar number, kept for reference.
 * - **Open interest.** Put OI ÷ call OI from Summary events. OI settles
 *   overnight and does not move intraday, so it is always the prior session's
 *   figure — never live.
 *
 * ## At-trade delta needs the tape, and the tape starts when we connect
 *
 * Trade events carry a running `dayVolume`. The contracts traded since the
 * previous event are `dayVolume − previous dayVolume`, and that increment is
 * weighted by the delta the feed holds for the option at that moment
 * (`recordTrade`). Differencing `dayVolume` rather than summing `size` keeps
 * every contract even when dxLink conflates prints into one event.
 *
 * Volume that traded *before* this server was watching — the first `dayVolume`
 * seen — has no at-trade delta. The only delta available for it is today's
 * current one, which is wrong in a known direction on a day the market moved:
 * a 0DTE put bought at 0.20 delta that has since gone in the money weighs in
 * at 0.90. Measured 2026-11-19 (SPY 737 open → 726 low → 728): near-money
 * whole-session 2.51 at current delta vs the volume ratio's 1.16.
 *
 * So the two are kept apart:
 * - `live` — only contracts traded since watching began, each at its at-trade
 *   delta. This is the headline. Its window is stated (`sinceMs`).
 * - session — the whole day's volume, pre-watch volume at the current delta.
 *   Shown as context, with the share that is current-delta weighted.
 *
 * ## Scope
 *
 * - **Near the money (headline):** strikes within ±5% of spot, expirations
 *   within 45 days, and no expiration that carries under 1% of that scope's
 *   volume. Far-dated and thinly traded expirations produce junk ratios (a
 *   handful of contracts setting a 4.0 put/call) and are listed, not counted.
 * - **Wide chain (secondary):** strikes within ±10% of spot, expirations
 *   within 90 days — everything the flow subscribes. Not the full chain: SPY
 *   lists ~12.3k contracts (~37k Trade+Greeks+Summary items) and dxLink refuses
 *   a connection's subscriptions past ~25k items ("subscription size is too
 *   big", measured 2026-11-19), which the gamma books share. ±10%/90d is ~3.4k
 *   contracts (~10.3k items) and holds most of the day's volume.
 *
 * Nothing here can tell a bought put from a sold put: that needs the trade's
 * side against the quote, which this does not have. It is a sentiment read.
 */

/** The shared label thresholds, used by every ratio on the panel. */
export const FLOW_LEAN = { bullishMax: 0.6, bearishMin: 1.0 } as const;
export type FlowLean = 'bullish' | 'neutral' | 'bearish';

/** Headline strike band: |strike − spot| / spot at most this. */
export const NEAR_MONEY_PCT = 0.05;
/** Headline expirations: at most this many calendar days out. */
export const HEADLINE_MAX_DTE = 45;
/** Headline expirations: at least this share of the near-money volume, else "thin". */
export const THIN_EXPIRY_SHARE = 0.01;
/** Wide-chain scope (what the flow subscribes): strikes within ±this of spot... */
export const WIDE_STRIKE_PCT = 0.1;
/** ...and expirations at most this many calendar days out. */
export const WIDE_MAX_DTE = 90;
/** Below this many contracts (both sides) in a scope or window, no ratio is printed. */
export const MIN_SCOPE_VOLUME = 500;

export function flowLean(ratio: number | null): FlowLean | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio <= FLOW_LEAN.bullishMax) return 'bullish';
  if (ratio >= FLOW_LEAN.bearishMin) return 'bearish';
  return 'neutral';
}

export function flowLeanLabel(lean: FlowLean | null): string {
  if (lean === 'bullish') return 'bullish lean';
  if (lean === 'bearish') return 'bearish lean';
  if (lean === 'neutral') return 'neutral';
  return 'no read';
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Running tally for one contract. */
export interface FlowTally {
  /** The option's latest `dayVolume`. */
  dayVolume: number;
  /** `dayVolume` when watching began: traded before this server saw the contract. */
  baseVolume: number;
  /** Epoch ms watching began (first Trade event, or the day's reset). */
  watchedSince: number;
  /** Σ |at-trade delta| × contracts, for volume traded since watching began. */
  liveDeltaVolume: number;
  /** Contracts traded since watching began while no delta was known; weighted at the next one. */
  pending: number;
}

/**
 * Fold one Trade event's `dayVolume` into a contract's tally. `delta` is the
 * option's delta from its latest Greeks event, or null when none has arrived;
 * `at` is when the event arrived. Returns a new tally; the input is not mutated.
 */
export function recordTrade(
  tally: FlowTally | undefined,
  dayVolume: number,
  delta: number | null,
  at: number,
): FlowTally | undefined {
  if (!finite(dayVolume) || dayVolume < 0) return tally;
  // First sight, or the day rolled over (dayVolume went down): what is there
  // already traded before we were watching.
  if (!tally || dayVolume < tally.dayVolume) {
    return { dayVolume, baseVolume: dayVolume, watchedSince: at, liveDeltaVolume: 0, pending: 0 };
  }
  const w = finite(delta) ? Math.abs(delta) : null;
  const increment = dayVolume - tally.dayVolume;
  const next: FlowTally = { ...tally, dayVolume };
  if (w === null) {
    next.pending += increment;
    return next;
  }
  next.liveDeltaVolume += w * (increment + next.pending);
  next.pending = 0;
  return next;
}

/** One contract's flow inputs, from its tally and its current delta. */
export interface FlowContract {
  type: 'call' | 'put';
  strike: number;
  /** `YYYY-MM-DD` */
  expiration: string;
  /** Contracts traded today (`dayVolume`). */
  volume: number;
  /** Σ |delta| × today's contracts; pre-watch volume at the current delta. */
  sessionDeltaVolume: number;
  /** The part of `sessionDeltaVolume` that is pre-watch volume at the current delta. */
  lateDeltaVolume: number;
  /** Contracts traded since watching began. */
  liveVolume: number;
  /** Σ |at-trade delta| × contracts since watching began. */
  liveDeltaVolume: number;
  /** Epoch ms watching began for this contract; null when never seen trading. */
  watchedSince: number | null;
  /** Prior-session settled OI, or null when no Summary event has arrived. */
  openInterest: number | null;
}

/** A tally plus the option's current delta → the contract's flow numbers. */
export function contractFlow(tally: FlowTally, delta: number | null) {
  const w = finite(delta) ? Math.abs(delta) : 0;
  const late = w * tally.baseVolume;
  const live = tally.liveDeltaVolume + w * tally.pending;
  return {
    volume: tally.dayVolume,
    sessionDeltaVolume: live + late,
    lateDeltaVolume: late,
    liveVolume: tally.dayVolume - tally.baseVolume,
    liveDeltaVolume: live,
    watchedSince: tally.watchedSince,
  };
}

export interface FlowWindow {
  callVolume: number;
  putVolume: number;
  callDeltaVolume: number;
  putDeltaVolume: number;
  /** Put ÷ call, |delta|-weighted. Null when too little has traded to mean anything. */
  deltaRatio: number | null;
  /** Put ÷ call contracts. */
  volumeRatio: number | null;
  deltaLean: FlowLean | null;
  volumeLean: FlowLean | null;
  /** Why the ratios are null, when they are. */
  note: string | null;
}

export interface FlowScope {
  /** Contracts in the scope. */
  contracts: number;
  expirations: string[];
  /** Since watching began, at-trade delta — the headline. */
  live: FlowWindow & {
    /** Every contract in scope has been watched since at least this (epoch ms); null if none. */
    sinceMs: number | null;
  };
  /** The whole session; pre-watch volume weighted at the current delta. */
  session: FlowWindow & {
    /** Share of the session's delta-weighted volume that is pre-watch at current delta, 0–1. */
    lateShare: number;
  };
  callOi: number;
  putOi: number;
  /** Put ÷ call open interest — prior session settled. */
  oiRatio: number | null;
  oiLean: FlowLean | null;
}

export interface ExcludedExpiration {
  expiration: string;
  dte: number;
  /** Near-money contracts traded in it today. */
  volume: number;
  reason: 'far-dated' | 'thin';
}

export interface FlowResult {
  spot: number;
  /** Strike band of the headline, inclusive. */
  band: { low: number; high: number };
  near: FlowScope;
  /** Every contract passed in (the flow passes the wide-chain scope). */
  wide: FlowScope;
  excluded: ExcludedExpiration[];
}

function ratio(put: number, call: number): number | null {
  return call > 0 ? put / call : null;
}

function windowOf(callVolume: number, putVolume: number, callDeltaVolume: number, putDeltaVolume: number): FlowWindow {
  const traded = callVolume + putVolume;
  const enough = traded >= MIN_SCOPE_VOLUME && callVolume > 0;
  const deltaRatio = enough ? ratio(putDeltaVolume, callDeltaVolume) : null;
  const volumeRatio = enough ? ratio(putVolume, callVolume) : null;
  return {
    callVolume,
    putVolume,
    callDeltaVolume,
    putDeltaVolume,
    deltaRatio,
    volumeRatio,
    deltaLean: flowLean(deltaRatio),
    volumeLean: flowLean(volumeRatio),
    note: enough
      ? null
      : traded >= MIN_SCOPE_VOLUME
        ? 'No call volume, so no ratio.'
        : `Only ${Math.round(traded).toLocaleString('en-US')} contracts so far (a ratio needs ${MIN_SCOPE_VOLUME}).`,
  };
}

function scopeOf(contracts: FlowContract[]): FlowScope {
  const s = { cv: 0, pv: 0, cd: 0, pd: 0 };
  const l = { cv: 0, pv: 0, cd: 0, pd: 0 };
  let callOi = 0;
  let putOi = 0;
  let late = 0;
  let since: number | null = null;
  const expirations = new Set<string>();
  for (const c of contracts) {
    expirations.add(c.expiration);
    const oi = finite(c.openInterest) && c.openInterest > 0 ? c.openInterest : 0;
    if (c.type === 'call') {
      s.cv += c.volume;
      s.cd += c.sessionDeltaVolume;
      l.cv += c.liveVolume;
      l.cd += c.liveDeltaVolume;
      callOi += oi;
    } else {
      s.pv += c.volume;
      s.pd += c.sessionDeltaVolume;
      l.pv += c.liveVolume;
      l.pd += c.liveDeltaVolume;
      putOi += oi;
    }
    late += c.lateDeltaVolume;
    if (c.watchedSince !== null) since = Math.max(since ?? 0, c.watchedSince);
  }
  const sessionDelta = s.cd + s.pd;
  const oiRatio = ratio(putOi, callOi);
  return {
    contracts: contracts.length,
    expirations: [...expirations].sort(),
    live: { ...windowOf(l.cv, l.pv, l.cd, l.pd), sinceMs: since },
    session: { ...windowOf(s.cv, s.pv, s.cd, s.pd), lateShare: sessionDelta > 0 ? late / sessionDelta : 0 },
    callOi,
    putOi,
    oiRatio,
    oiLean: flowLean(oiRatio),
  };
}

/**
 * The headline (near the money) and wide-chain flow from per-contract inputs.
 * Expired contracts are dropped by the shared expiry rule.
 */
export function computeFlow(all: FlowContract[], spot: number, now: Date = new Date()): FlowResult {
  const live = all.filter((c) => !isExpired(c.expiration, now));
  const low = spot * (1 - NEAR_MONEY_PCT);
  const high = spot * (1 + NEAR_MONEY_PCT);
  const band = live.filter((c) => c.strike >= low && c.strike <= high);

  // Near-money volume by expiration, to find the far-dated and the thin.
  const byExpiry = new Map<string, number>();
  for (const c of band) byExpiry.set(c.expiration, (byExpiry.get(c.expiration) ?? 0) + c.volume);
  const excluded: ExcludedExpiration[] = [];
  const inDte = [...byExpiry.entries()].filter(([exp, volume]) => {
    const dte = daysToExpiry(exp, now);
    if (dte <= HEADLINE_MAX_DTE) return true;
    excluded.push({ expiration: exp, dte, volume, reason: 'far-dated' });
    return false;
  });
  const inDteVolume = inDte.reduce((s, [, v]) => s + v, 0);
  const kept = new Set<string>();
  for (const [exp, volume] of inDte) {
    if (inDteVolume > 0 && volume / inDteVolume < THIN_EXPIRY_SHARE) {
      excluded.push({ expiration: exp, dte: daysToExpiry(exp, now), volume, reason: 'thin' });
    } else {
      kept.add(exp);
    }
  }
  excluded.sort((a, b) => (a.expiration < b.expiration ? -1 : 1));

  return {
    spot,
    band: { low, high },
    near: scopeOf(band.filter((c) => kept.has(c.expiration))),
    wide: scopeOf(live),
    excluded,
  };
}
