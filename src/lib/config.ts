/**
 * Central place for every tunable. All of these are read from `process.env`
 * on the server only — none of them are `NEXT_PUBLIC_`, so the API key can
 * never be inlined into the client bundle.
 */

import 'server-only';

import type { VwapAnchor } from './scanner/types';

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
      /**
       * The near-money window the option spread is measured over.
       *
       * Strikes each side of spot rather than a percentage band, because a
       * count adapts to strike spacing on its own — the same band is four
       * strikes wide on one name and forty on another.
       */
      nearMoneyStrikesEachSide: num(process.env.GAMMADESK_LIQ_NEAR_STRIKES, 10),
      /** Monthly expiries, nearest first, the spread is drawn from. */
      nearMoneyExpiries: num(process.env.GAMMADESK_LIQ_NEAR_EXPIRIES, 2),
      /**
       * Strikes that must survive the filter before a spread is reported.
       * Under this the panel says so rather than printing a figure from a
       * sample too thin to mean anything.
       */
      minNearMoneyStrikes: num(process.env.GAMMADESK_LIQ_MIN_NEAR_STRIKES, 5),
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
  /**
   * The morning scanner — /scanner.
   *
   * Everything the scan can be argued about lives here, because most of it
   * will be. The scan time, the strictness, and above all the
   * Nadaraya-Watson settings are meant to be moved without a code change:
   * the NW reading is only useful if it agrees with the chart the reader is
   * actually looking at, and that means matching their TradingView inputs.
   */
  get scanner() {
    return {
      /**
       * Composite RS score a name must clear to be a candidate.
       *
       * This is the gate for the whole pipeline — nothing downstream ever sees
       * a name below it, including the near-miss list. Raising it shrinks the
       * gamma refresh proportionally, which is the constraint that matters:
       * see `gammaRefreshBudget` below.
       */
      rsMin: num(process.env.GAMMADESK_SCAN_RS_MIN, 82),

      /**
       * When the scan runs, as New York wall-clock `HH:MM`.
       *
       * Displayed on the page and used for nothing else — the actual trigger
       * is the cron entry in `vercel.json`, which cannot read this. Moving the
       * scan means editing both, and the page states the time it was told
       * about rather than the time it ran, so a mismatch is visible.
       *
       * 9:35 is deliberately early and deliberately noisy. Five minutes of
       * session VWAP is five minutes of the day's worst tape; a name can sit
       * above VWAP at 9:35 and below it at 9:40. The page says so.
       */
      scanTimeEt: (process.env.GAMMADESK_SCAN_TIME_ET ?? '09:35').trim(),
      /** When the candidate gamma refresh runs, same caveat. */
      gammaTimeEt: (process.env.GAMMADESK_SCAN_GAMMA_TIME_ET ?? '08:30').trim(),

      /**
       * Chains the 8:30 job may request in one run.
       *
       * Cboe answers roughly sixty per window and then refuses — a quota, not
       * a rate, so slowing down buys nothing (see `scanUniverse.ts`). At the
       * default RS floor of 82 the candidate list is about fifty names, and
       * SPY is always fetched first because filter 5 gates the entire scan.
       *
       * Note how little headroom that leaves. The floor and this budget are
       * coupled: the composite score concentrates hard toward the middle — a
       * weighted mean of three weakly-correlated percentiles is not itself a
       * percentile — so the candidate count climbs steeply as the floor comes
       * down. 90 gives 27 names, 82 gives 50, 80 gives 58, which is already
       * over the Cboe window. Check with `?dry=1` on the gamma endpoint before
       * lowering it further; that reports the count without spending a chain.
       *
       * If the candidate list ever exceeds this, the run stops at the budget
       * and reports what it did not reach rather than filling the tail with
       * failures.
       */
      gammaRefreshBudget: Math.min(
        60,
        Math.max(5, num(process.env.GAMMADESK_SCAN_GAMMA_BUDGET, 55)),
      ),

      /**
       * Which VWAP anchor each timeframe uses.
       *
       * A session anchor on a daily bar series is meaningless — every bar is
       * its own session, so VWAP would equal the typical price and the filter
       * would be a coin toss. The week anchor gives 4H and daily something to
       * actually measure against. Stated in the UI, not just here.
       */
      vwapAnchor: {
        '1h': (process.env.GAMMADESK_SCAN_VWAP_1H ?? 'session') as VwapAnchor,
        '4h': (process.env.GAMMADESK_SCAN_VWAP_4H ?? 'week') as VwapAnchor,
        '1D': (process.env.GAMMADESK_SCAN_VWAP_1D ?? 'week') as VwapAnchor,
      },

      /** Trend EMA the price must sit above for filter 7. */
      trendEmaPeriod: Math.max(
        5,
        num(process.env.GAMMADESK_SCAN_TREND_EMA, 200),
      ),

      /**
       * Nadaraya-Watson inputs, matching the LuxAlgo envelope defaults.
       *
       * These exist to be tuned to the reader's own chart. The scanner and the
       * chart have to be able to agree on whether a name is above its band; if
       * they cannot, the column is worse than absent.
       *
       * `bandwidth` is the Gaussian h, `lookback` the number of bars the
       * estimator and the band width are computed over, `mult` the multiple of
       * mean absolute error the envelope sits at.
       */
      nw: {
        bandwidth: Math.max(0.5, num(process.env.GAMMADESK_SCAN_NW_H, 8)),
        lookback: Math.max(
          20,
          Math.round(num(process.env.GAMMADESK_SCAN_NW_LOOKBACK, 499)),
        ),
        mult: Math.max(0.1, num(process.env.GAMMADESK_SCAN_NW_MULT, 3)),
        /**
         * Fewest bars that will produce a reading at all.
         *
         * Below this the band is marked unknown and the ticker is excluded,
         * rather than being failed — "we could not tell" and "it is below the
         * band" are different statements and the page keeps them apart.
         */
        minBars: Math.max(
          30,
          Math.round(num(process.env.GAMMADESK_SCAN_NW_MIN_BARS, 120)),
        ),
      },

      /** Days of finished scans kept, so a missed morning is still readable. */
      keepDays: Math.max(1, num(process.env.GAMMADESK_SCAN_KEEP_DAYS, 5)),

      /**
       * Bar series fetched at once during a scan.
       *
       * Three timeframes per candidate against Yahoo, which publishes no
       * quota; six in flight measured comfortably under a minute for a full
       * candidate list and has not drawn a throttle.
       */
      barConcurrency: Math.max(
        1,
        num(process.env.GAMMADESK_SCAN_BAR_CONCURRENCY, 6),
      ),
      /** Wall-clock backstop for the bar phase, leaving room to store. */
      barBudgetMs: Math.max(
        10_000,
        num(process.env.GAMMADESK_SCAN_BAR_BUDGET_MS, 220_000),
      ),
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
