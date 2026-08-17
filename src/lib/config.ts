/**
 * Central place for every tunable. All of these are read from `process.env`
 * on the server only — none of them are `NEXT_PUBLIC_`, so the API key can
 * never be inlined into the client bundle.
 */

import 'server-only';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type SourceChoice = 'cboe' | 'polygon';

function sourceChoice(): SourceChoice {
  return (process.env.GAMMADESK_DATA_SOURCE ?? 'cboe').trim().toLowerCase() === 'polygon'
    ? 'polygon'
    : 'cboe';
}

export const config = {
  /**
   * Which upstream to pull the chain from. Defaults to Cboe because open
   * interest — the basis of every number here — is not available on Polygon's
   * free plan at all.
   */
  get dataSource(): SourceChoice {
    return sourceChoice();
  },
  get apiKey(): string | undefined {
    const key = process.env.POLYGON_API_KEY?.trim();
    return key && key !== 'your_polygon_key_here' ? key : undefined;
  },
  get symbol(): string {
    return (process.env.GAMMADESK_SYMBOL ?? 'SPY').trim().toUpperCase();
  },
  /**
   * How long one upstream refresh is reused.
   *
   * The floor is source-dependent. Polygon's free plan allows only 5 requests
   * per minute, so a short interval there risks the quota; Cboe is keyless,
   * costs a single request, and has no published limit, so it can refresh
   * often enough to be useful while the market is open.
   */
  get cacheSeconds(): number {
    const floor = sourceChoice() === 'polygon' ? 300 : 60;
    const fallback = sourceChoice() === 'polygon' ? 1800 : 300;
    return Math.max(floor, num(process.env.GAMMADESK_CACHE_SECONDS, fallback));
  },
  /**
   * How long a ticker consensus is reused. Daily bars only change once a
   * session, so an hour is generous and keeps repeated searches free.
   */
  get tickerCacheSeconds(): number {
    return Math.max(60, num(process.env.GAMMADESK_TICKER_CACHE_SECONDS, 3600));
  },
  get expirationCount(): number {
    return Math.min(12, Math.max(1, num(process.env.GAMMADESK_EXPIRATIONS, 5)));
  },
  /**
   * Expirations the forecast draws magnets from. The dashboard shows five,
   * spanning about a week; a 20-session simulation needs enough expiries to
   * cover the whole horizon or the paths run unshaped for most of it.
   */
  get forecastExpirations(): number {
    return Math.min(40, Math.max(5, num(process.env.GAMMADESK_FORECAST_EXPIRATIONS, 20)));
  },
  /** Trading days simulated forward. */
  get forecastHorizon(): number {
    return Math.min(60, Math.max(5, num(process.env.GAMMADESK_FORECAST_DAYS, 20)));
  },
  /** Monte Carlo paths. */
  get forecastPaths(): number {
    return Math.min(20_000, Math.max(200, num(process.env.GAMMADESK_FORECAST_PATHS, 1000)));
  },
  get forecastCacheSeconds(): number {
    return Math.max(300, num(process.env.GAMMADESK_FORECAST_CACHE_SECONDS, 1800));
  },
  /**
   * Least share of its expiry's total gamma exposure a strike must hold before
   * the forecast chart draws it as a magnet. Display only — the simulation is
   * still shaped by the full field. Without it every significant strike gets a
   * marker on every simulated day, which is hundreds of overlapping dots.
   */
  get magnetMinExposureShare(): number {
    return Math.min(1, Math.max(0, num(process.env.GAMMADESK_MAGNET_MIN_SHARE, 0.05)));
  },
  /**
   * Widest expiration set any consumer needs. The chain is trimmed to this
   * once, so the dashboard and the forecast share a single upstream fetch.
   */
  get maxExpirations(): number {
    return Math.max(this.expirationCount, this.forecastExpirations);
  },
  get strikesEachSide(): number {
    return Math.min(80, Math.max(5, num(process.env.GAMMADESK_STRIKES_EACH_SIDE, 30)));
  },
  get riskFreeRate(): number {
    return num(process.env.GAMMADESK_RISK_FREE_RATE, 0.043);
  },
  get dividendYield(): number {
    return num(process.env.GAMMADESK_DIVIDEND_YIELD, 0.012);
  },

  /**
   * Tradeability tiers — the cutoffs behind the HIGH/MEDIUM/LOW words on the
   * decision page.
   *
   * These live here, and are carried into the rendered payload, so the label
   * can state its own basis. A tier the reader cannot check is a tier they
   * have no reason to believe: "HIGH" on its own is an assertion, "HIGH —
   * at or above $250M a day" is a claim they can disagree with.
   *
   * Equity and options are rated separately and never blended. A name can
   * have a deep cash market and a chain that barely prints, and one number
   * covering both would hide exactly the case that matters.
   */
  get tradeability() {
    return {
      /** Average daily dollar volume over the sample window, in dollars. */
      equityDollarVolume: {
        high: num(process.env.GAMMADESK_LIQ_EQUITY_DV_HIGH, 250_000_000),
        medium: num(process.env.GAMMADESK_LIQ_EQUITY_DV_MEDIUM, 25_000_000),
      },
      /** Contracts traded per day across the whole listed chain. */
      optionsVolume: {
        high: num(process.env.GAMMADESK_LIQ_OPT_VOL_HIGH, 50_000),
        medium: num(process.env.GAMMADESK_LIQ_OPT_VOL_MEDIUM, 5_000),
      },
      /** Contracts of open interest across the whole listed chain. */
      optionsOpenInterest: {
        high: num(process.env.GAMMADESK_LIQ_OPT_OI_HIGH, 250_000),
        medium: num(process.env.GAMMADESK_LIQ_OPT_OI_MEDIUM, 25_000),
      },
      /**
       * Open interest below which GEX/VEX/CEX are suppressed rather than
       * shown.
       *
       * Every exposure figure on this site is open interest multiplied by a
       * modelled greek. When the open interest is a few hundred contracts the
       * product is arithmetic on noise — it will still render a confident
       * dollar figure, which is worse than rendering nothing.
       */
      minOpenInterestForExposure: num(
        process.env.GAMMADESK_LIQ_MIN_OI_FOR_EXPOSURE,
        10_000,
      ),
      /** Sessions of daily bars averaged for the equity figures. */
      sampleSessions: 20,
    };
  },

  /**
   * US net liquidity (WALCL − WTREGEN − RRPONTSYD).
   *
   * Regime context only. Nothing here may reach a score — see
   * `lib/netLiquidity`.
   */
  get netLiquidity() {
    return {
      /**
       * Weekly change, in percent, that a move must clear before it is called
       * rising or falling. Below it the tile says Flat.
       *
       * Two of the three series are weekly Wednesday prints revised after the
       * fact, so sub-percent wobble is measurement noise. Naming a 0.1% drift
       * "falling liquidity" invents a signal.
       */
      flatThresholdPct: Math.max(
        0,
        num(process.env.GAMMADESK_NETLIQ_FLAT_PCT, 0.25),
      ),
      /** Weeks of history kept for the sparkline and the expanded table. */
      historyWeeks: Math.max(4, num(process.env.GAMMADESK_NETLIQ_WEEKS, 13)),
      /**
       * Oldest a forward-filled print may be before its week is dropped.
       *
       * The fill exists for public holidays, where a Wednesday has no repo
       * print and the Tuesday value is the honest stand-in. It is not a
       * licence to carry a number forward indefinitely: RRPONTSYD has gaps of
       * months to years before about 2014, and an unbounded fill would pair a
       * 2004 repo figure with a 2007 balance sheet and render the result as a
       * real weekly print.
       *
       * Eight days clears any holiday run while rejecting anything staler.
       */
      maxFillDays: Math.max(1, num(process.env.GAMMADESK_NETLIQ_MAX_FILL_DAYS, 8)),
      get cacheSeconds(): number {
        // Weekly data. An hour is already far finer than the series moves.
        return Math.max(600, num(process.env.GAMMADESK_NETLIQ_CACHE_SECONDS, 3600));
      },
    };
  },
} as const;

/**
 * Free-plan budget. One full refresh must fit inside a single minute's quota:
 * 1 previous-close call + up to 4 pages of the options-chain snapshot.
 */
export const POLYGON_LIMITS = {
  requestsPerMinute: 5,
  maxSnapshotPages: 4,
  pageSize: 250,
  /** Calendar-day horizon requested from the API when picking expirations. */
  expiryHorizonDays: 16,
} as const;
