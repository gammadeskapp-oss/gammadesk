import 'server-only';

import { cached, invalidate } from '@/lib/cache';
import { parseOccSymbol } from '@/lib/cboe';
import { config } from '@/lib/config';
import { formatAsOf, isExpired } from '@/lib/time';
import { fetchBars, normaliseSymbol } from './bars';
import type {
  Bar,
  EquityLiquidity,
  Liquidity,
  LiquidityLabel,
  OptionsLiquidity,
  TierCutoffs,
} from './types';

/**
 * Tradeability — how easily one name can actually be dealt in.
 *
 * Rated as two separate things, because they answer two different questions
 * and a single verdict hides the case that matters most:
 *
 *   - equity liquidity  — can I get in and out of the shares?
 *   - options liquidity — are the contracts tradeable, and is the exposure
 *                         maths built on them reliable?
 *
 * A mega-cap with a barely-traded chain is highly liquid by the first measure
 * and unusable by the second. The old single score let an active chain lift a
 * borderline name and let a dead chain disappear behind deep cash volume;
 * both are now visible.
 *
 * Every cutoff comes from `config.tradeability` and is carried out in the
 * payload, so the panel can state the basis for the word it prints.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

interface CboeContract {
  /** OCC symbol — the only place strike and expiry appear in this feed. */
  option?: string;
  bid?: number;
  ask?: number;
  volume?: number;
  open_interest?: number;
}

interface CboeChain {
  timestamp?: string;
  data?: {
    bid?: number;
    ask?: number;
    current_price?: number;
    options?: CboeContract[];
  };
}

interface ChainActivity {
  volume: number;
  openInterest: number;
  /**
   * Open-interest-weighted quoted spread across the near-money window, as a
   * fraction of the contract's mid.
   */
  spreadPct: number | null;
  spreadSample: number;
  /** Distinct strikes behind `spreadPct`. */
  spreadStrikes: number;
  /** Underlying quoted spread as a fraction of mid, when two-sided. */
  underlyingSpreadPct: number | null;
  asOfLabel: string | null;
}

function tierOf(value: number, cutoffs: TierCutoffs): LiquidityLabel {
  if (value >= cutoffs.high) return 'HIGH';
  if (value >= cutoffs.medium) return 'MEDIUM';
  return 'LOW';
}

/**
 * Quoted spread as a fraction of the mid.
 *
 * Returns null rather than a number whenever the quote is not genuinely
 * two-sided — outside hours, or on a contract nobody is making a market in,
 * the feed reports a zero on one side. A crossed book (ask below bid) is
 * likewise rejected instead of being clamped into a plausible-looking figure.
 */
function quotedSpreadPct(bid?: number, ask?: number): number | null {
  if (typeof bid !== 'number' || typeof ask !== 'number') return null;
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  return (ask - bid) / mid;
}

/**
 * A standard monthly expiry — the third Friday of its month.
 *
 * Read off the date rather than from any feed field, because the chain
 * carries none. The third Friday is the only Friday that can fall on the
 * 15th through the 21st, so the range test is exact.
 */
function isMonthlyExpiry(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  return d.getUTCDay() === 5 && day >= 15 && day <= 21;
}

/**
 * The contracts a user would realistically trade: the nearest few strikes
 * either side of spot, in the nearest monthly expiries.
 *
 * Filtered by strike count, not by delta. The chain carries no delta field
 * and this file will not model one — a Black-Scholes delta needs an implied
 * vol per contract, and inventing that to draw a liquidity boundary would put
 * a modelled assumption underneath a figure meant to describe observed quotes.
 */
function nearMoneyContracts(
  contracts: CboeContract[],
  spot: number,
): { c: CboeContract; strike: number }[] {
  const tuning = config.tradeability;

  const parsed = contracts.flatMap((c) => {
    const p = c.option ? parseOccSymbol(c.option) : null;
    return p ? [{ c, strike: p.strike, expiration: p.expiration }] : [];
  });

  // Live by the shared rule (16:00 New York on the expiry date), not a UTC
  // date, which rolls over at 19:00 or 20:00 ET and dropped same-day expiries early.
  const expiries = new Set(
    [...new Set(parsed.map((p) => p.expiration))]
      .filter((e) => !isExpired(e) && isMonthlyExpiry(e))
      .sort()
      .slice(0, tuning.nearMoneyExpiries),
  );

  const inExpiry = parsed.filter((p) => expiries.has(p.expiration));
  const allStrikes = [...new Set(inExpiry.map((p) => p.strike))].sort((a, b) => a - b);
  const keep = new Set([
    ...allStrikes.filter((s) => s <= spot).slice(-tuning.nearMoneyStrikesEachSide),
    ...allStrikes.filter((s) => s > spot).slice(0, tuning.nearMoneyStrikesEachSide),
  ]);

  return inExpiry.filter((p) => keep.has(p.strike));
}

/**
 * What one read of the Cboe chain produced. `missing` is the source saying
 * there is no chain (404, or an empty one); `unread` is the source failing to
 * answer at all (blocked, timed out, malformed). They were one `null`, and the
 * second was then reported as "no chain / not enough liquidity" — a claim
 * about the market made from a fact about the network.
 */
type ChainRead =
  | { kind: 'ok'; activity: ChainActivity }
  | { kind: 'missing' }
  | { kind: 'unread'; detail: string };

/**
 * Listed options activity from the same Cboe feed the dashboard uses.
 *
 * Best-effort by design: a symbol with no listed options simply 404s, and any
 * other failure is reported as unread — which the panel renders as an
 * explicit "could not be read" state — rather than failing the whole lookup or
 * substituting a placeholder figure.
 */
async function fetchChainActivity(symbol: string): Promise<ChainRead> {
  try {
    const res = await fetch(
      `https://cdn-api.cboe.com/api/global/delayed_quotes/options/${symbol}.json`,
      {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
        next: { revalidate: 3600 },
      },
    );
    if (res.status === 404) return { kind: 'missing' };
    if (!res.ok) return { kind: 'unread', detail: `the options source answered ${res.status}` };

    const body = (await res.json()) as CboeChain;
    const contracts = body.data?.options;
    if (!Array.isArray(contracts) || contracts.length === 0) return { kind: 'missing' };

    let volume = 0;
    let openInterest = 0;

    for (const c of contracts) {
      const contractVolume = typeof c.volume === 'number' ? c.volume : 0;
      if (contractVolume > 0) volume += contractVolume;
      if (typeof c.open_interest === 'number') openInterest += c.open_interest;
    }

    /*
     * Spread is measured only over the near-money window, and weighted by
     * open interest inside it. Averaged across the whole chain it described a
     * book nobody trades — far-dated, far-out-of-the-money strikes quoted a
     * dollar wide on a five-cent option — and made almost every name look
     * untradeable. Weighting by open interest keeps a dead strike holding one
     * contract from counting as much as a busy one beside it.
     */
    const spot = body.data?.current_price;
    let spreadWeighted = 0;
    let spreadWeight = 0;
    let spreadSample = 0;
    const spreadStrikes = new Set<number>();

    if (typeof spot === 'number' && spot > 0) {
      for (const { c, strike } of nearMoneyContracts(contracts, spot)) {
        const oi = typeof c.open_interest === 'number' ? c.open_interest : 0;
        const spread = quotedSpreadPct(c.bid, c.ask);
        if (spread !== null && oi > 0) {
          spreadWeighted += spread * oi;
          spreadWeight += oi;
          spreadSample += 1;
          spreadStrikes.add(strike);
        }
      }
    }

    const enoughStrikes =
      spreadStrikes.size >= config.tradeability.minNearMoneyStrikes;

    return {
      kind: 'ok',
      activity: {
        volume,
        openInterest,
        spreadPct:
          enoughStrikes && spreadWeight > 0 ? spreadWeighted / spreadWeight : null,
        spreadSample: enoughStrikes ? spreadSample : 0,
        spreadStrikes: spreadStrikes.size,
        underlyingSpreadPct: quotedSpreadPct(body.data?.bid, body.data?.ask),
        // The feed stamps its own snapshot; parsed as ET, which is what it is.
        asOfLabel: body.timestamp
          ? formatAsOf(new Date(`${body.timestamp.replace(' ', 'T')}-04:00`))
          : null,
      },
    };
  } catch (error) {
    return {
      kind: 'unread',
      detail:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'the options source timed out'
          : 'the options source could not be read',
    };
  }
}

function equityFrom(bars: Bar[], underlyingSpreadPct: number | null): EquityLiquidity {
  const tuning = config.tradeability;
  const recent = bars.slice(-tuning.sampleSessions);
  const sessions = Math.max(1, recent.length);
  const avgDollarVolume = recent.reduce((a, b) => a + b.volume * b.close, 0) / sessions;
  return {
    tier: tierOf(avgDollarVolume, tuning.equityDollarVolume),
    avgDollarVolume,
    avgShareVolume: recent.reduce((a, b) => a + b.volume, 0) / sessions,
    spreadPct: underlyingSpreadPct,
    cutoffs: tuning.equityDollarVolume,
    sessions,
  };
}

/** An options block with nothing measured — not listed, or not read. */
function unmeasuredOptions(status: 'not-listed' | 'unread'): OptionsLiquidity {
  const tuning = config.tradeability;
  return {
    status,
    listed: false,
    tier: null,
    volume: null,
    openInterest: null,
    spreadPct: null,
    spreadSample: 0,
    spreadStrikes: 0,
    minSpreadStrikes: tuning.minNearMoneyStrikes,
    spreadStrikesEachSide: tuning.nearMoneyStrikesEachSide,
    spreadExpiries: tuning.nearMoneyExpiries,
    // An unread chain is not an unreliable one — nothing was measured. The
    // exposure gate (lib/decision/exposureGate) reads `status`, not this.
    exposureReliable: false,
    volumeCutoffs: tuning.optionsVolume,
    openInterestCutoffs: tuning.optionsOpenInterest,
    minOpenInterestForExposure: tuning.minOpenInterestForExposure,
  };
}

/**
 * The options tier from a complete read: the weaker of volume and open
 * interest, not their average. They fail in different ways — heavy volume on a
 * chain with no open interest is day-trading froth, deep open interest with no
 * volume is a book nobody can currently get out of — and averaging lets either
 * one paper over the other.
 */
function assessedOptions(
  chain: Pick<ChainActivity, 'volume' | 'openInterest' | 'spreadPct' | 'spreadSample' | 'spreadStrikes'>,
  notes: string[],
): OptionsLiquidity {
  const tuning = config.tradeability;
  const byVolume = tierOf(chain.volume, tuning.optionsVolume);
  const byOpenInterest = tierOf(chain.openInterest, tuning.optionsOpenInterest);
  const rank: Record<LiquidityLabel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const tier = rank[byVolume] <= rank[byOpenInterest] ? byVolume : byOpenInterest;

  const options: OptionsLiquidity = {
    status: 'assessed',
    listed: true,
    tier,
    volume: chain.volume,
    openInterest: chain.openInterest,
    spreadPct: chain.spreadPct,
    spreadSample: chain.spreadSample,
    spreadStrikes: chain.spreadStrikes,
    minSpreadStrikes: tuning.minNearMoneyStrikes,
    spreadStrikesEachSide: tuning.nearMoneyStrikesEachSide,
    spreadExpiries: tuning.nearMoneyExpiries,
    exposureReliable: chain.openInterest >= tuning.minOpenInterestForExposure,
    volumeCutoffs: tuning.optionsVolume,
    openInterestCutoffs: tuning.optionsOpenInterest,
    minOpenInterestForExposure: tuning.minOpenInterestForExposure,
  };

  if (!options.exposureReliable) {
    notes.push(
      `Chain open interest is ${Math.round(chain.openInterest).toLocaleString('en-US')} contracts, below the ${tuning.minOpenInterestForExposure.toLocaleString('en-US')} needed to compute exposure reliably. GEX, VEX and CEX are suppressed rather than estimated.`,
    );
  } else if (byVolume === 'LOW') {
    notes.push(
      'The chain holds open interest but is barely traded today, so quoted spreads on it will be wide.',
    );
  }
  return options;
}

function pushEquityNotes(equity: EquityLiquidity, notes: string[]): void {
  if (equity.tier === 'LOW') {
    notes.push(
      'Thin cash volume — position sizes that move the price are easy to reach.',
    );
  }
}

export async function assessLiquidity(
  symbol: string,
  bars: Bar[],
): Promise<Liquidity> {
  const read = await fetchChainActivity(symbol);
  const chain = read.kind === 'ok' ? read.activity : null;
  const notes: string[] = [];

  const equity = equityFrom(bars, chain?.underlyingSpreadPct ?? null);

  let options: OptionsLiquidity;
  if (read.kind === 'ok') {
    options = assessedOptions(read.activity, notes);
  } else if (read.kind === 'missing') {
    options = unmeasuredOptions('not-listed');
    notes.push(
      'No listed options chain was returned for this symbol, so the options figures and every exposure number derived from them are unavailable.',
    );
  } else {
    options = unmeasuredOptions('unread');
    notes.push(
      `The options chain could not be read (${read.detail}), so the options figures are unavailable. That is a failed lookup, not a verdict on the chain, and it is retried on the next view.`,
    );
  }

  pushEquityNotes(equity, notes);

  return {
    equity,
    options,
    asOfLabel: chain?.asOfLabel ?? null,
    sourceLabel: 'Cboe delayed chain',
    notes,
  };
}

/** What `/lab` hands in from the Tastytrade stream. Plain numbers only. */
export interface FeedOptionsBook {
  /** Summed Summary open interest over the subscribed contracts. */
  openInterest: number;
  /** Summed Trade day volume over the same contracts. */
  volume: number;
  /** Contracts subscribed, and how many reported both IV and open interest. */
  optionsExpected: number;
  optionsComplete: number;
  /** Underlying quote off the feed, for the share spread. */
  underlyingBid: number | null;
  underlyingAsk: number | null;
  asOfLabel: string | null;
  sourceLabel: string;
}

/** Share of contracts that must have reported before the feed's book is complete. */
const FEED_COMPLETE_RATIO = 0.9;

/**
 * Tradeability for `/lab`, from the Tastytrade stream — the same source as the
 * book the page draws — and never from Cboe.
 *
 * The options verdict is given only after a complete load (the same 90% rule
 * the feed applies before it builds a book). Before that it is `unread`: the
 * data is still arriving, which says nothing about the chain. The share
 * figures come from the daily bars the chart already reads; the share spread
 * from the feed's own underlying quote.
 *
 * The feed's scope is the gamma book's (±7% of spot, seven expirations), not
 * the whole chain, so its totals are a floor on the chain's — still far over
 * the open-interest floor on any chain that is genuinely deep.
 */
export async function assessFeedLiquidity(
  rawSymbol: string,
  feed: FeedOptionsBook,
): Promise<Liquidity | null> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) return null;
  const bars = await cached(`tradeability-bars:${symbol}`, config.tickerCacheSeconds, async () => {
    const { bars } = await fetchBars(symbol, { withName: false });
    if (bars.length === 0) throw new Error('no bars');
    return bars;
  }).catch((): Bar[] => []);

  const notes: string[] = [];
  const equity = equityFrom(
    bars,
    quotedSpreadPct(feed.underlyingBid ?? undefined, feed.underlyingAsk ?? undefined),
  );
  const complete =
    feed.optionsExpected > 0 && feed.optionsComplete >= feed.optionsExpected * FEED_COMPLETE_RATIO;

  let options: OptionsLiquidity;
  if (complete) {
    options = assessedOptions(
      {
        volume: feed.volume,
        openInterest: feed.openInterest,
        // No option quotes are subscribed on the feed (dxLink rate-limits
        // subscriptions), so there is no option spread to report.
        spreadPct: null,
        spreadSample: 0,
        spreadStrikes: 0,
      },
      notes,
    );
    notes.push(
      `Options figures are the live feed's, over the gamma book's scope (${feed.optionsExpected.toLocaleString('en-US')} contracts near the money), not the whole chain. No option quotes are streamed, so no option spread is measured.`,
    );
  } else {
    options = unmeasuredOptions('unread');
    notes.push(
      `Open interest is still arriving from the feed (${feed.optionsComplete.toLocaleString('en-US')} of ${feed.optionsExpected.toLocaleString('en-US')} contracts). No options verdict is given until the load is complete.`,
    );
  }
  if (bars.length === 0) notes.push('Daily bars could not be read, so the share volume figures are empty.');
  pushEquityNotes(equity, notes);

  return { equity, options, asOfLabel: feed.asOfLabel, sourceLabel: feed.sourceLabel, notes };
}

/**
 * Tradeability for one symbol, fetching its own daily bars.
 *
 * The decision page needs this without paying for a full nine-signal
 * consensus. Cached on the same TTL as the ticker analysis, so a name opened
 * on either page costs one upstream fetch between them — except a result
 * whose chain could not be read, which is dropped from the cache at once so
 * one blocked or timed-out request does not stand for an hour as a reading.
 *
 * Throws nothing: a symbol whose bars cannot be read returns null and the
 * caller renders an unavailable state. It must never return a placeholder —
 * a fabricated tier would be read as a real one.
 */
export async function getTradeability(rawSymbol: string): Promise<Liquidity | null> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) return null;

  const key = `tradeability:${symbol}`;
  try {
    const result = await cached(
      key,
      config.tickerCacheSeconds,
      async () => {
        // Only the last few weeks are averaged, and the company name costs an
        // extra upstream request the panel never displays.
        const { bars } = await fetchBars(symbol, { withName: false });
        if (bars.length === 0) throw new Error('no bars');
        return assessLiquidity(symbol, bars);
      },
    );
    if (result.options.status === 'unread') invalidate(key);
    return result;
  } catch {
    return null;
  }
}
