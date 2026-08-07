import 'server-only';

import type { Bar, Liquidity, LiquidityLabel } from './types';

/**
 * Tradability score.
 *
 * The primary input is average daily dollar volume, which is what actually
 * determines whether a position can be entered and exited without moving the
 * price. Listed options activity is a secondary confirmation: a name with a
 * deep, actively traded chain is easier to work with than one whose options
 * barely print.
 */

/** Dollar-volume thresholds for US equities, in dollars per day. */
const HIGH_DOLLAR_VOLUME = 250_000_000;
const MEDIUM_DOLLAR_VOLUME = 25_000_000;

/** Contracts per day across the whole chain. */
const HIGH_OPTIONS_VOLUME = 50_000;
const MEDIUM_OPTIONS_VOLUME = 5_000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

interface CboeChain {
  data?: {
    options?: Array<{ volume?: number; open_interest?: number }>;
  };
}

/**
 * Listed options activity from the same Cboe feed the dashboard uses.
 *
 * Best-effort: a symbol with no listed options simply 404s, and any failure
 * degrades to "no options data" rather than failing the whole lookup.
 */
async function fetchOptionsActivity(
  symbol: string,
): Promise<{ volume: number; openInterest: number } | null> {
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
      if (typeof c.volume === 'number') volume += c.volume;
      if (typeof c.open_interest === 'number') openInterest += c.open_interest;
    }
    return { volume, openInterest };
  } catch {
    return null;
  }
}

export async function assessLiquidity(
  symbol: string,
  bars: Bar[],
): Promise<Liquidity> {
  const recent = bars.slice(-20);

  const avgShareVolume =
    recent.reduce((a, b) => a + b.volume, 0) / Math.max(1, recent.length);
  const avgDollarVolume =
    recent.reduce((a, b) => a + b.volume * b.close, 0) / Math.max(1, recent.length);

  const options = await fetchOptionsActivity(symbol);
  const notes: string[] = [];

  // Base rating on cash liquidity.
  let score =
    avgDollarVolume >= HIGH_DOLLAR_VOLUME ? 2 : avgDollarVolume >= MEDIUM_DOLLAR_VOLUME ? 1 : 0;

  if (options) {
    const optionScore =
      options.volume >= HIGH_OPTIONS_VOLUME ? 2 : options.volume >= MEDIUM_OPTIONS_VOLUME ? 1 : 0;

    // An active chain can lift a borderline name, but thin options never drag
    // a genuinely liquid stock down — the shares are what you trade.
    if (optionScore > score) score = Math.min(2, score + 1);

    if (optionScore === 0) {
      notes.push('Options are listed but barely traded, so spreads there will be wide.');
    }
  } else {
    notes.push('No listed options found for this symbol.');
  }

  if (avgDollarVolume < MEDIUM_DOLLAR_VOLUME) {
    notes.push('Thin cash volume — position sizes that move the price are easy to reach.');
  }

  const label: LiquidityLabel = score >= 2 ? 'HIGH' : score === 1 ? 'MEDIUM' : 'LOW';

  return {
    label,
    avgDollarVolume,
    avgShareVolume,
    optionsVolume: options?.volume ?? null,
    optionsOpenInterest: options?.openInterest ?? null,
    hasOptions: options !== null,
    notes,
  };
}
