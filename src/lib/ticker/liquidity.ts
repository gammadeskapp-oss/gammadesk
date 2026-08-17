import 'server-only';

import { cached } from '@/lib/cache';
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
  /** Volume-weighted quoted spread, as a fraction of the contract's mid. */
  spreadPct: number | null;
  spreadSample: number;
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

    /*
     * Spread is weighted by volume and drawn only from contracts that traded.
     * The chain is mostly far-dated, far-out-of-the-money strikes quoted a
     * dollar wide on a five-cent option; averaging those in unweighted would
     * describe a book nobody is trading rather than the one they are.
     */
    let spreadWeighted = 0;
    let spreadWeight = 0;
    let spreadSample = 0;

    for (const c of contracts) {
      const contractVolume = typeof c.volume === 'number' ? c.volume : 0;
      if (contractVolume > 0) volume += contractVolume;
      if (typeof c.open_interest === 'number') openInterest += c.open_interest;

      const spread = quotedSpreadPct(c.bid, c.ask);
      if (spread !== null && contractVolume > 0) {
        spreadWeighted += spread * contractVolume;
        spreadWeight += contractVolume;
        spreadSample += 1;
      }
    }

    return {
      volume,
      openInterest,
      spreadPct: spreadWeight > 0 ? spreadWeighted / spreadWeight : null,
      spreadSample,
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
