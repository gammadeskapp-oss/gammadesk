import 'server-only';

import { cached } from '@/lib/cache';
import { parseOccSymbol } from '@/lib/cboe';
import { config } from '@/lib/config';
import { formatAsOf } from '@/lib/time';
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

  const today = new Date().toISOString().slice(0, 10);
  const expiries = new Set(
    [...new Set(parsed.map((p) => p.expiration))]
      .filter((e) => e >= today && isMonthlyExpiry(e))
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
 * Listed options activity from the same Cboe feed the dashboard uses.
 *
 * Best-effort by design: a symbol with no listed options simply 404s, and any
 * failure degrades to "no options data" — which the panel renders as an
 * explicit unavailable state — rather than failing the whole lookup or
 * substituting a placeholder figure.
 */
async function fetchChainActivity(symbol: string): Promise<ChainActivity | null> {
  try {
    const res = await fetch(
      `https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol}.json`,
      {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;

    const body = (await res.json()) as CboeChain;
    const contracts = body.data?.options;
    if (!Array.isArray(contracts) || contracts.length === 0) return null;

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
    };
  } catch {
    return null;
  }
}

export async function assessLiquidity(
  symbol: string,
  bars: Bar[],
): Promise<Liquidity> {
  const tuning = config.tradeability;
  const recent = bars.slice(-tuning.sampleSessions);
  const sessions = Math.max(1, recent.length);

  const avgShareVolume = recent.reduce((a, b) => a + b.volume, 0) / sessions;
  const avgDollarVolume =
    recent.reduce((a, b) => a + b.volume * b.close, 0) / sessions;

  const chain = await fetchChainActivity(symbol);
  const notes: string[] = [];

  const equity: EquityLiquidity = {
    tier: tierOf(avgDollarVolume, tuning.equityDollarVolume),
    avgDollarVolume,
    avgShareVolume,
    spreadPct: chain?.underlyingSpreadPct ?? null,
    cutoffs: tuning.equityDollarVolume,
    sessions,
  };

  /*
   * The options tier is the weaker of volume and open interest, not their
   * average. They fail in different ways — heavy volume on a chain with no
   * open interest is day-trading froth, deep open interest with no volume is
   * a book nobody can currently get out of — and averaging lets either one
   * paper over the other.
   */
  let options: OptionsLiquidity;
  if (chain === null) {
    options = {
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
      exposureReliable: false,
      volumeCutoffs: tuning.optionsVolume,
      openInterestCutoffs: tuning.optionsOpenInterest,
      minOpenInterestForExposure: tuning.minOpenInterestForExposure,
    };
    notes.push(
      'No listed options chain was returned for this symbol, so the options figures and every exposure number derived from them are unavailable.',
    );
  } else {
    const byVolume = tierOf(chain.volume, tuning.optionsVolume);
    const byOpenInterest = tierOf(chain.openInterest, tuning.optionsOpenInterest);
    const rank: Record<LiquidityLabel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    const tier = rank[byVolume] <= rank[byOpenInterest] ? byVolume : byOpenInterest;

    options = {
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
  }

  if (equity.tier === 'LOW') {
    notes.push(
      'Thin cash volume — position sizes that move the price are easy to reach.',
    );
  }

  return {
    equity,
    options,
    asOfLabel: chain?.asOfLabel ?? null,
    notes,
  };
}

/**
 * Tradeability for one symbol, fetching its own daily bars.
 *
 * The decision page needs this without paying for a full nine-signal
 * consensus. Cached on the same TTL as the ticker analysis, so a name opened
 * on either page costs one upstream fetch between them.
 *
 * Throws nothing: a symbol whose bars cannot be read returns null and the
 * caller renders an unavailable state. It must never return a placeholder —
 * a fabricated tier would be read as a real one.
 */
export async function getTradeability(rawSymbol: string): Promise<Liquidity | null> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) return null;

  try {
    return await cached(
      `tradeability:${symbol}`,
      config.tickerCacheSeconds,
      async () => {
        // Only the last few weeks are averaged, and the company name costs an
        // extra upstream request the panel never displays.
        const { bars } = await fetchBars(symbol, { withName: false });
        if (bars.length === 0) throw new Error('no bars');
        return assessLiquidity(symbol, bars);
      },
    );
  } catch {
    return null;
  }
}
