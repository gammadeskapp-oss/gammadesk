import 'server-only';

import { getBars } from '../bars/intraday';
import { config } from '../config';
import { createJsonStore } from '../jsonStore';
import { getRsResult } from '../rs';
import { DEFAULT_MIN_DOLLAR_VOLUME, DEFAULT_WEIGHTS, type RsRow } from '../rs/types';
import { runScan } from '../scanUniverse';
import { ema } from '../ticker/indicators';
import { marketToday } from '../time';
import { readTodaysGamma } from './gamma';
import { nwState } from './nadarayaWatson';
import { anchoredVwap, lastDefined, type SeriesBar } from './series';
import {
  hasNw,
  SCAN_TIMEFRAMES,
  type FilterVerdict,
  type GammaEntry,
  type LiquidityTier,
  type ScanResult,
  type ScanRow,
  type ScanTimeframe,
  type SingleFilterKey,
  type StoredGamma,
  type StoredScans,
  type TimeframeReading,
} from './types';

/**
 * The 9:35 ET scan.
 *
 * Filter 1 runs first and everything downstream sees only its survivors —
 * that is not an optimisation, it is what makes the job possible at all. The
 * gamma refresh an hour earlier only covered names above the RS floor, and the
 * bar phase here costs three upstream series per candidate, so widening filter
 * 1 widens both.
 *
 * Every filter is resolved for every candidate and stored, including for
 * names that clearly fail. The near-miss section and the strictness toggle are
 * both derived from that stored detail at render time, so neither costs a
 * re-scan.
 */

const scanStore = createJsonStore<StoredScans>(
  'gammadesk/scanner-scans.json',
  () => ({ scans: [] }),
  (raw) =>
    raw && typeof raw === 'object' && Array.isArray((raw as StoredScans).scans)
      ? (raw as StoredScans)
      : null,
);

/**
 * Share of the configured lookback a band must be measured over before the
 * shortfall is treated as immaterial and goes unreported.
 *
 * The band width is a flat mean, so its sensitivity to the sample size is
 * roughly linear: a 10% shorter window moves the edges by about a tenth of the
 * difference between the near-window and far-window average deviation, which
 * is small. Well below that — the 4H case, at half the window — it is not, and
 * that is why 4H is excluded outright rather than merely flagged.
 */
const SHORT_BAND_RATIO = 0.9;

// --- filter 3: tiers ---------------------------------------------------------

function tierOf(value: number, cutoffs: { high: number; medium: number }): LiquidityTier {
  if (value >= cutoffs.high) return 'HIGH';
  if (value >= cutoffs.medium) return 'MEDIUM';
  return 'LOW';
}

const TIER_RANK: Record<LiquidityTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * The options tier is the weaker of volume and open interest, never their
 * average — the same rule `ticker/liquidity.ts` applies, and for the same
 * reason: they fail in different ways and averaging lets either paper over the
 * other. A page that rated tradeability one way in one place and another way
 * elsewhere would be worse than one that did not rate it at all.
 */
function optionsTierOf(entry: GammaEntry): LiquidityTier {
  const tuning = config.tradeability;
  const byVolume = tierOf(entry.optionsVolume, tuning.optionsVolume);
  const byOi = tierOf(entry.optionsOpenInterest, tuning.optionsOpenInterest);
  return TIER_RANK[byVolume] <= TIER_RANK[byOi] ? byVolume : byOi;
}

// --- filters 6, 7, 8 ---------------------------------------------------------

/** A timeframe we could not read at all. Unknown throughout, with the reason. */
function unreadable(timeframe: ScanTimeframe, reason: string): TimeframeReading {
  const unknown: FilterVerdict = { state: 'unknown', detail: 'no bars' };
  return {
    timeframe,
    close: null,
    vwapAnchor: config.scanner.vwapAnchor[timeframe],
    vwap: null,
    ema: null,
    nw: {
      // `unavailable` where there is no band by design, `unknown` where there
      // should have been one and the bars did not arrive. Different facts.
      state: hasNw(timeframe) ? 'unknown' : 'unavailable',
      z: null,
      mid: null,
      upper: null,
      lower: null,
      barsUsed: 0,
      barsWanted: config.scanner.nw.lookback,
    },
    verdicts: { vwap: unknown, ema: unknown },
    bars: null,
    error: reason,
  };
}

/**
 * Where the close sits inside the envelope, in half-band units.
 *
 * `(close - centre) / (upper - centre)`, so 1 is the upper edge, 0 the centre
 * line and -1 the lower edge. Left unbounded: the whole point of ranking on it
 * is the separation between names, and clamping would flatten exactly that.
 *
 * Null when the band has no width — a perfectly flat series — because the
 * ratio is undefined there rather than infinite.
 */
function bandZ(close: number | null, point: { mid: number; upper: number } | null): number | null {
  if (close === null || !point) return null;
  const half = point.upper - point.mid;
  if (!(half > 0)) return null;
  return (close - point.mid) / half;
}

function readTimeframe(timeframe: ScanTimeframe, bars: SeriesBar[]): TimeframeReading {
  const tuning = config.scanner;
  const anchor = tuning.vwapAnchor[timeframe];
  const closes = bars.map((b) => b.c);
  const close = closes[closes.length - 1] ?? null;

  const vwap = lastDefined(anchoredVwap(bars, anchor));
  const trendEma = lastDefined(ema(closes, tuning.trendEmaPeriod));

  /*
   * The band is computed only where the history supports it — see
   * `NW_TIMEFRAMES`. On 4H it is skipped outright rather than reported from
   * half the intended window.
   */
  const nw = hasNw(timeframe)
    ? nwState(closes, tuning.nw, tuning.nw.minBars)
    : null;

  /*
   * Every one of these returns `unknown` rather than `fail` when the input is
   * missing. A 200 EMA needs 200 bars and a 4-hour series does not always have
   * them; reporting that as "price is below its 200 EMA" would be a statement
   * about the market made entirely out of a gap in the data.
   */
  const vwapVerdict: FilterVerdict =
    close === null || vwap === null
      ? { state: 'unknown', detail: 'no VWAP' }
      : close > vwap
        ? { state: 'pass', detail: `above ${anchor} VWAP` }
        : { state: 'fail', detail: `below ${anchor} VWAP` };

  const emaVerdict: FilterVerdict =
    close === null || trendEma === null
      ? {
          state: 'unknown',
          detail: `under ${tuning.trendEmaPeriod} bars`,
        }
      : close > trendEma
        ? { state: 'pass', detail: `above ${tuning.trendEmaPeriod} EMA` }
        : { state: 'fail', detail: `below ${tuning.trendEmaPeriod} EMA` };

  /*
   * No NW verdict. It is a score now, not a gate: nothing here can fail the
   * scan on where price sits relative to the band, because the endpoint
   * estimator hugs recent price while the band is set by the window-average
   * deviation, and requiring price to clear it eliminated everything nearly
   * every day. `nw.z` carries the reading and the board ranks on it.
   */
  return {
    timeframe,
    close,
    vwapAnchor: anchor,
    vwap,
    ema: trendEma,
    nw: {
      state: nw?.state ?? 'unavailable',
      z: bandZ(close, nw?.point ?? null),
      mid: nw?.point?.mid ?? null,
      upper: nw?.point?.upper ?? null,
      lower: nw?.point?.lower ?? null,
      barsUsed: nw?.barsUsed ?? 0,
      barsWanted: nw?.barsWanted ?? tuning.nw.lookback,
    },
    verdicts: { vwap: vwapVerdict, ema: emaVerdict },
    bars: bars.length,
  };
}

/** All three timeframes for one symbol. */
async function readTimeframes(symbol: string): Promise<TimeframeReading[]> {
  return Promise.all(
    SCAN_TIMEFRAMES.map(async (timeframe) => {
      try {
        const series = await getBars(symbol, timeframe);
        if (series.bars.length === 0) return unreadable(timeframe, 'no bars returned');
        return readTimeframe(timeframe, series.bars);
      } catch (error) {
        return unreadable(
          timeframe,
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
}

// --- the pipeline ------------------------------------------------------------

/** Names above the RS floor, strongest first. Filter 1, and the whole gate. */
export async function scanCandidates(): Promise<{ rows: RsRow[]; universe: number }> {
  const rs = await getRsResult(DEFAULT_WEIGHTS, DEFAULT_MIN_DOLLAR_VOLUME);
  return {
    rows: rs.rows
      .filter((r) => r.score >= config.scanner.rsMin)
      .sort((a, b) => b.score - a.score),
    universe: rs.universe,
  };
}

function singleVerdicts(
  row: RsRow,
  gamma: StoredGamma | null,
  entry: GammaEntry | undefined,
  spy: GammaEntry | undefined,
): { verdicts: Record<SingleFilterKey, FilterVerdict>; tiers: {
  equity: LiquidityTier | null;
  options: LiquidityTier | null;
} } {
  const tuning = config.tradeability;

  // Filter 1. Every row here has already cleared it; the verdict exists so the
  // page can show every gate state for every ticker rather than all of them
  // minus the one that is true by construction.
  const rs: FilterVerdict = { state: 'pass', detail: `RS ${row.score.toFixed(0)}` };

  // Filter 2. `null` means there was not enough history to tell, which is not
  // the same as unconfirmed and is not recorded as such.
  const volume: FilterVerdict =
    row.confirmation === null
      ? { state: 'unknown', detail: 'not enough history' }
      : row.confirmation === 'confirmed'
        ? { state: 'pass', detail: 'CONF' }
        : { state: 'fail', detail: 'UNCONF' };

  // Filter 3. Equity comes from the RS digest's own turnover figure, so it
  // costs nothing; the options tier comes from the chain the 8:30 job already
  // fetched. Neither spends an upstream request here.
  const equityTier = tierOf(row.avgDollarVolume, tuning.equityDollarVolume);
  const optionsTier = entry ? optionsTierOf(entry) : null;

  let liquidity: FilterVerdict;
  if (optionsTier === null) {
    liquidity = { state: 'unknown', detail: `equity ${equityTier}, options unread` };
  } else {
    const detail = `equity ${equityTier}, options ${optionsTier}`;
    const ok = equityTier === 'HIGH' && TIER_RANK[optionsTier] >= TIER_RANK.MEDIUM;
    liquidity = { state: ok ? 'pass' : 'fail', detail };
  }

  // Filters 4 and 5. A missing chain is unknown, never a fail — the scan must
  // not report "dealers are short gamma here" when what happened is that Cboe
  // did not answer.
  const gammaVerdict: FilterVerdict = !entry
    ? {
        state: 'unknown',
        detail: gamma ? 'chain not read at 08:30' : 'no same-day refresh',
      }
    : entry.regime === 'positive'
      ? { state: 'pass', detail: 'positive' }
      : { state: 'fail', detail: 'negative' };

  const spyVerdict: FilterVerdict = !spy
    ? { state: 'unknown', detail: 'SPY chain not read' }
    : spy.regime === 'positive'
      ? { state: 'pass', detail: 'SPY positive' }
      : { state: 'fail', detail: 'SPY negative' };

  return {
    verdicts: {
      rs,
      volume,
      liquidity,
      gamma: gammaVerdict,
      spyGamma: spyVerdict,
    },
    tiers: { equity: equityTier, options: optionsTier },
  };
}

/**
 * Run the scan and store it.
 *
 * The SPY gate short-circuits before the bar phase. When SPY's own gamma is
 * negative every candidate fails filter 5 no matter what its chart looks like,
 * so fetching a hundred and fifty bar series to confirm that would be spending
 * upstream requests to produce a list nobody should act on. The result is
 * stored with the reason, and the page states it.
 */
export async function runScanner(): Promise<ScanResult> {
  const tuning = config.scanner;
  const { rows: candidates, universe } = await scanCandidates();
  const gamma = await readTodaysGamma();
  const spy = gamma?.symbols.SPY;

  const notes: string[] = [];
  if (!gamma) {
    notes.push(
      `No same-day gamma refresh was found, so filters 4 and 5 are unknown for every name and nothing can pass. The ${tuning.gammaTimeEt} ET job either has not run or could not store its result. The nightly cache is deliberately not used as a substitute — it can be four days old.`,
    );
  } else {
    if (gamma.failures.length > 0) {
      notes.push(
        `${gamma.failures.length} candidate chains could not be read at ${tuning.gammaTimeEt} ET: ${gamma.failures.map((f) => f.symbol).join(', ')}. Their gamma and options-liquidity filters are unknown rather than failed.`,
      );
    }
    if (gamma.skipped.length > 0) {
      notes.push(
        `${gamma.skipped.length} candidates were past the ${tuning.gammaRefreshBudget}-chain budget and were not refreshed: ${gamma.skipped.join(', ')}.`,
      );
    }
  }

  /*
   * Filter 5 is a single market-wide gate. When it is shut the answer is an
   * empty scan *with the reason attached*, not a list of names that each look
   * fine on their own — in a negative-gamma regime dealers amplify moves, and
   * a page of strong-looking charts is at its most misleading exactly then.
   *
   * A SPY chain that could not be read is deliberately not treated as a
   * closed gate. Nothing will pass either way, because filter 5 reports
   * unknown, but the scan still runs so the near-miss section can say what
   * everything else did.
   */
  const gateReason =
    spy && spy.regime !== 'positive'
      ? 'SPY gamma is negative, so filter 5 fails for every name in the universe. The scan is empty on purpose rather than by accident.'
      : null;


  const barFailures: string[] = [];
  const rows: ScanRow[] = [];

  const outcome = await runScan(
    candidates.map((r) => r.symbol),
    async (symbol) => {
      const row = candidates.find((r) => r.symbol === symbol)!;
      const entry = gamma?.symbols[symbol];
      const { verdicts, tiers } = singleVerdicts(row, gamma, entry, spy);

      /*
       * The bar phase runs even when the SPY gate is shut, and it is worth
       * saying why it is worth the requests on a day when nothing can pass.
       *
       * A closed gate makes the pass list empty by definition. What it must
       * not also do is make the page useless: on a zero-result day the
       * near-miss list is the whole point, because it is what says whether the
       * rules are too tight. Skipping the bars would leave every candidate
       * failing filter 5 *and* carrying three unknown timeframe filters, so
       * nothing would qualify as missing by exactly one and the section would
       * be empty on precisely the day it matters most.
       *
       * Run them, and a strong name on a negative-gamma morning shows up as a
       * near-miss with "SPY gamma" named as the one thing that stopped it —
       * which is the true and useful statement. These are Yahoo bar series and
       * do not touch the Cboe quota that constrains the 08:30 job.
       */
      const timeframes = await readTimeframes(symbol);
      if (timeframes.every((t) => t.bars === null)) barFailures.push(symbol);

      rows.push({
        symbol,
        price: row.close,
        priceAsOf: row.asOfDate,
        rsScore: row.score,
        rsRank: row.rank,
        equityTier: tiers.equity,
        optionsTier: tiers.options,
        regime: entry?.regime ?? null,
        netGex: entry?.netGex ?? null,
        magnets: entry?.magnets ?? [],
        single: verdicts,
        timeframes,
      });
    },
    {
      concurrency: tuning.barConcurrency,
      budgetMs: tuning.barBudgetMs,
      // The quota that matters here is Cboe's, and this phase does not touch
      // it — these are Yahoo bar series. Every candidate is attempted.
      maxRequests: candidates.length,
      pauseMs: 0,
    },
  );

  if (outcome.skipped.length > 0) {
    notes.push(
      `${outcome.skipped.length} candidates were not reached before the bar-phase time budget expired: ${outcome.skipped.join(', ')}. They are absent from this scan rather than shown as failing.`,
    );
  }
  /*
   * The band width is a flat mean over `lookback` bars, so a timeframe that
   * cannot supply them produces a narrower sample and a different band from
   * the reader's chart, which does have the history. The centre line is
   * unaffected — the Gaussian tail is negligible past a few dozen bars — so
   * this is invisible by eye and only shows up in the edges, which is exactly
   * what the pass/fail state is read off. Yahoo serves about six months of
   * 4-hour bars, so this fires on 4H routinely and is stated rather than
   * quietly tolerated.
   */
  const shortBand = new Map<
    string,
    { fewest: number; wanted: number; symbols: string[] }
  >();
  for (const row of rows) {
    for (const tf of row.timeframes) {
      /*
       * Only a *material* shortfall is worth a caveat. A daily series one bar
       * short of the window moves the band by nothing, and reporting it would
       * train the reader to skip these notes — at which point the one that
       * matters gets skipped too.
       */
      const short = tf.nw.barsUsed < tf.nw.barsWanted * SHORT_BAND_RATIO;
      if (tf.bars === null || !hasNw(tf.timeframe) || !short) continue;

      const seen = shortBand.get(tf.timeframe);
      if (seen) {
        seen.fewest = Math.min(seen.fewest, tf.nw.barsUsed);
        seen.symbols.push(row.symbol);
      } else {
        shortBand.set(tf.timeframe, {
          fewest: tf.nw.barsUsed,
          wanted: tf.nw.barsWanted,
          symbols: [row.symbol],
        });
      }
    }
  }
  for (const [timeframe, { fewest, wanted, symbols }] of shortBand) {
    /*
     * Named per symbol rather than per timeframe, because the two causes are
     * different and the fix is different. On 1H every candidate is short,
     * because the bar source simply does not serve that much intraday history.
     * On daily it is one or two recent listings that do not have two years of
     * trading behind them yet — nothing is wrong with the source, and nothing
     * will fix it but time. Saying "that is all the history available at this
     * interval" would have been false for the second case.
     */
    const affected =
      symbols.length === rows.length
        ? 'every candidate'
        : `${symbols.length} candidate${symbols.length === 1 ? '' : 's'} (${symbols.join(', ')})`;

    notes.push(
      `On ${timeframe} the Nadaraya-Watson band width is measured over fewer than the configured ${wanted} bars for ${affected} — as few as ${fewest}. The centre line is unaffected; the band edges are drawn from a shorter sample than a chart with the full history would use, so treat those ${timeframe} z-scores as approximate.`,
    );
  }

  if (barFailures.length > 0) {
    notes.push(
      `${barFailures.length} candidates returned no bars on any timeframe: ${barFailures.join(', ')}. Their timeframe filters are unknown.`,
    );
  }

  const result: ScanResult = {
    date: marketToday(),
    scannedAt: new Date().toISOString(),
    scheduledEt: tuning.scanTimeEt,
    rows: rows.sort((a, b) => b.rsScore - a.rsScore),
    universe,
    candidates: candidates.length,
    rsMin: tuning.rsMin,
    spyRegime: spy?.regime ?? null,
    gateReason,
    gammaDate: gamma?.date ?? null,
    gammaRefreshedAt: gamma?.refreshedAt ?? null,
    barFailures,
    barSkipped: outcome.skipped,
    notes,
  };

  try {
    await scanStore.update((current) => ({
      scans: [result, ...current.scans.filter((s) => s.date !== result.date)]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, tuning.keepDays),
    }));
  } catch {
    // Return what was computed. The page falls back to reporting that today's
    // scan has not been stored, which is true and visible, rather than serving
    // an older day's list under today's heading.
  }

  return result;
}

/**
 * Today's stored scan, or null.
 *
 * Never falls back to a previous day. A list built on Tuesday's VWAP under a
 * Wednesday heading is the exact failure this whole page is arranged to
 * prevent, and "no scan yet today" is a real answer the page can render.
 */
export async function readTodaysScan(): Promise<ScanResult | null> {
  const stored = await scanStore.read().catch(() => null);
  if (!stored) return null;
  const today = marketToday();
  return stored.scans.find((s) => s.date === today) ?? null;
}

/** The most recent stored scan whatever its date, for the "last run" line. */
export async function readLatestScan(): Promise<ScanResult | null> {
  const stored = await scanStore.read().catch(() => null);
  return stored?.scans[0] ?? null;
}
