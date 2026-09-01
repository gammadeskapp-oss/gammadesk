import 'server-only';

import { getBars } from '../bars/intraday';
import { config } from '../config';
import { createJsonStore } from '../jsonStore';
import { getRsResult } from '../rs';
import { DEFAULT_MIN_DOLLAR_VOLUME, DEFAULT_WEIGHTS, type RsRow } from '../rs/types';
import { runScan } from '../scanUniverse';
import { ema } from '../ticker/indicators';
import { marketToday } from '../time';
import { archiveScan } from './archive';
import { readExtension } from './evaluate';
import { lookupEarnings } from './earnings';
import { excludedForEarnings } from './earningsRules';
import { readTodaysGamma } from './gamma';
import { nwState } from './nadarayaWatson';
import { gradeSymbol } from './optionChain';
import { lastDefined, type SeriesBar } from './series';
import {
  EARNINGS_EXCLUSION_DAYS,
  FILTER_KEYS,
  hasNw,
  OPTION_QUALITY_TOP_N,
  SCAN_TIMEFRAMES,
  type FilterKey,
  type FilterVerdict,
  type GammaEntry,
  type LiquidityTier,
  type ScanResult,
  type ScanRow,
  type ScanTimeframe,
  type StoredGamma,
  type StoredScans,
  type TimeframeReading,
} from './types';

/** The short average the extended flag is measured against. */
const EXTENSION_EMA_PERIOD = 20;

/**
 * The 9:35 ET scan.
 *
 * Filter 1 runs first and everything downstream sees only its survivors —
 * that is not an optimisation, it is what makes the job possible at all. The
 * gamma refresh an hour earlier only covered names above the RS floor, and the
 * bar phase here costs three upstream series per candidate, so lowering the
 * floor widens both.
 *
 * Every gate is resolved for every candidate and stored, including for names
 * that clearly fail — "every candidate scanned" is rendered from that stored
 * detail, which is what lets a zero-result morning show its working without a
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

/** A timeframe we could not read at all, with the reason. */
function unreadable(timeframe: ScanTimeframe, reason: string): TimeframeReading {
  return {
    timeframe,
    close: null,
    ema: null,
    ema20: null,
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
  const closes = bars.map((b) => b.c);
  const close = closes[closes.length - 1] ?? null;

  const trendEma = lastDefined(ema(closes, tuning.trendEmaPeriod));
  const shortEma = lastDefined(ema(closes, EXTENSION_EMA_PERIOD));

  /*
   * The band is computed only where the history supports it — see
   * `NW_TIMEFRAMES`. On 4H it is skipped outright rather than reported from
   * half the intended window.
   */
  const nw = hasNw(timeframe)
    ? nwState(closes, tuning.nw, tuning.nw.minBars)
    : null;

  /*
   * No verdicts here any more. The only trend gate is the daily 200-day
   * average, resolved once in `singleVerdicts`; VWAP left the scan entirely,
   * and the band is a line on the chart. What this returns is drawing
   * material and the bar counts that qualify it.
   */
  return {
    timeframe,
    close,
    ema: trendEma,
    ema20: shortEma,
    nw: {
      state: nw?.state ?? 'unavailable',
      z: bandZ(close, nw?.point ?? null),
      mid: nw?.point?.mid ?? null,
      upper: nw?.point?.upper ?? null,
      lower: nw?.point?.lower ?? null,
      barsUsed: nw?.barsUsed ?? 0,
      barsWanted: nw?.barsWanted ?? tuning.nw.lookback,
    },
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
  daily: TimeframeReading | undefined,
): { verdicts: Record<FilterKey, FilterVerdict>; tiers: {
  equity: LiquidityTier | null;
  options: LiquidityTier | null;
} } {
  const tuning = config.tradeability;

  /*
   * Gate 1. Every row here has already cleared the floor, so this is true by
   * construction — but it is still tested rather than asserted, because a
   * page that shows a reader a gate state has to have actually evaluated it.
   */
  const rs: FilterVerdict =
    row.score >= config.scanner.rsMin
      ? { state: 'pass', detail: `RS ${row.score.toFixed(0)}, outperforming most of the market` }
      : { state: 'fail', detail: `RS ${row.score.toFixed(0)}, below the ${config.scanner.rsMin} floor` };

  // Filter 2. `null` means there was not enough history to tell, which is not
  // the same as unconfirmed and is not recorded as such.
  const volume: FilterVerdict =
    row.confirmation === null
      ? { state: 'unknown', detail: 'not enough history to compare against its normal volume' }
      : row.confirmation === 'confirmed'
        ? { state: 'pass', detail: 'trading above its own normal volume' }
        : { state: 'fail', detail: 'not trading above its normal volume' };

  // Filter 3. Equity comes from the RS digest's own turnover figure, so it
  // costs nothing; the options tier comes from the chain the 8:30 job already
  // fetched. Neither spends an upstream request here.
  const equityTier = tierOf(row.avgDollarVolume, tuning.equityDollarVolume);
  const optionsTier = entry ? optionsTierOf(entry) : null;

  let liquidity: FilterVerdict;
  if (optionsTier === null) {
    liquidity = {
      state: 'unknown',
      detail: `shares ${equityTier.toLowerCase()}, but the options chain was not read`,
    };
  } else {
    const detail = `shares ${equityTier.toLowerCase()}, options ${optionsTier.toLowerCase()}`;
    const ok = equityTier === 'HIGH' && TIER_RANK[optionsTier] >= TIER_RANK.MEDIUM;
    liquidity = { state: ok ? 'pass' : 'fail', detail };
  }

  /*
   * Gate 4: the 200-day average, on the daily series and nowhere else.
   *
   * `unknown` rather than `fail` when the history is short. A 200-day average
   * needs 200 daily bars, and a recent listing does not have them; reporting
   * that as "below its 200-day average" would be a statement about the market
   * assembled entirely out of a gap in the data. Unknown keeps it off the
   * list exactly as a fail would, and says why.
   */
  const emaVerdict: FilterVerdict =
    !daily || daily.close === null || daily.ema === null
      ? {
          state: 'unknown',
          detail: `fewer than ${config.scanner.trendEmaPeriod} daily bars, so the long-term trend could not be read`,
        }
      : daily.close > daily.ema
        ? { state: 'pass', detail: 'above the 200-day average, so the long-term trend is up' }
        : { state: 'fail', detail: 'below the 200-day average' };

  /*
   * Gate 5, the one market-wide gate. A SPY chain that could not be read is
   * unknown, never a fail — the scan must not report "the market is in a
   * volatile regime" when what happened is that Cboe did not answer.
   *
   * The name's own gamma is deliberately not a gate. It is carried on the row
   * as context text instead: the single-name dealer-sign assumption is the
   * weakest thing this app rests on, and quietly deleting names on the
   * strength of it was giving that assumption more authority than it has.
   */
  const spyVerdict: FilterVerdict = !spy
    ? { state: 'unknown', detail: 'the SPY chain could not be read, so the market regime is unknown' }
    : spy.regime === 'positive'
      ? { state: 'pass', detail: 'SPY is in a calm regime' }
      : { state: 'fail', detail: 'SPY is in a volatile regime' };

  void gamma;
  void entry;

  return {
    verdicts: {
      rs,
      ema: emaVerdict,
      volume,
      liquidity,
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
   * The market regime is a single market-wide gate, and it is hard. When it
   * is shut the answer is an empty scan *with the reason attached*, not a list
   * of names that each look fine on their own — in a volatile regime dealers
   * amplify moves, and a page of strong-looking charts is at its most
   * misleading exactly then. There is no softening toggle: a zero-result day
   * is the correct output, and an option that turns the market gate into a
   * score penalty exists only to produce results on days that should not have
   * any.
   *
   * A SPY chain that could not be read is deliberately not treated as a closed
   * gate. Nothing will pass either way, because the gate reports unknown, but
   * the scan still runs so "every candidate scanned" can say what everything
   * else did.
   */
  const gateReason =
    spy && spy.regime !== 'positive'
      ? 'SPY is in a volatile regime, so the market gate fails for every name in the universe. The scan is empty on purpose rather than by accident.'
      : null;


  const barFailures: string[] = [];
  const rows: ScanRow[] = [];

  const outcome = await runScan(
    candidates.map((r) => r.symbol),
    async (symbol) => {
      const row = candidates.find((r) => r.symbol === symbol)!;
      const entry = gamma?.symbols[symbol];

      /*
       * The bar phase runs even when the market gate is shut, and it is worth
       * saying why it is worth the requests on a day when nothing can pass.
       *
       * A closed gate makes the pass list empty by definition. What it must
       * not also do is make the page useless: on a zero-result day "every
       * candidate scanned" is the whole point, because it is what says whether
       * the market was the problem or the rules were. Skipping the bars would
       * leave every candidate carrying an unknown trend gate on top of the
       * failed market gate, so that section would report nothing on precisely
       * the day it matters most.
       *
       * These are Yahoo bar series and do not touch the Cboe quota that
       * constrains the 08:30 job.
       */
      const timeframes = await readTimeframes(symbol);
      if (timeframes.every((t) => t.bars === null)) barFailures.push(symbol);

      const daily = timeframes.find((t) => t.timeframe === '1D');
      const { verdicts, tiers } = singleVerdicts(row, gamma, entry, spy, daily);

      /*
       * The 20-day average comes off the daily bars already in hand, so the
       * extended flag costs nothing. Computed here rather than in the board so
       * the flag is stored with the scan and cannot drift if the thresholds
       * move later.
       */
      const extension = readExtension(daily?.close ?? null, daily?.ema20 ?? null);

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
        // Filled in below, once every candidate has been read: the earnings
        // lookup is one batched request for the whole list, not one per name.
        earnings: { state: 'unknown', dateIso: null, daysAway: null, source: 'not looked up' },
        extension,
        optionQuality: null,
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
      `${barFailures.length} candidates returned no bars on any timeframe: ${barFailures.join(', ')}. Their 200-day average gate is unknown rather than failed.`,
    );
  }

  /*
   * ## Earnings, and the exclusion
   *
   * One batched lookup for every candidate, after the bar phase and before
   * anything is ranked. See `earnings.ts` for why this is Tradier's
   * fundamentals calendar and not the macro calendar in `lib/events`, which
   * carries no per-company dates.
   *
   * A name reporting inside the window is removed outright, not flagged. An
   * options position held over an earnings report is a different trade from
   * the one every filter above was testing for, and a shortlist that mixes the
   * two is the most expensive thing this page could get wrong.
   *
   * A name whose date could not be established is *kept*, with the uncertainty
   * on its watch line. Excluding those would empty the page every day the
   * fundamentals endpoint is unavailable, which on this token is most of them.
   * `excludedForEarnings` reads the state rather than the day count precisely
   * so that unknown can never be mistaken for far-away.
   */
  const scanDate = marketToday();
  const earnings = await lookupEarnings(rows.map((r) => r.symbol), scanDate);

  for (const row of rows) {
    row.earnings = earnings.bySymbol.get(row.symbol) ?? {
      state: 'unknown',
      dateIso: null,
      daysAway: null,
      source: 'not looked up',
    };
  }

  const earningsExcluded: ScanResult['earningsExcluded'] = [];
  const kept: ScanRow[] = [];
  for (const row of rows) {
    if (excludedForEarnings(row.earnings) && row.earnings.dateIso && row.earnings.daysAway !== null) {
      earningsExcluded.push({
        symbol: row.symbol,
        dateIso: row.earnings.dateIso,
        daysAway: row.earnings.daysAway,
      });
      continue;
    }
    kept.push(row);
  }

  if (earningsExcluded.length > 0) {
    notes.push(
      `${earningsExcluded.length} name${earningsExcluded.length === 1 ? ' was' : 's were'} removed for reporting earnings within ${EARNINGS_EXCLUSION_DAYS} days: ${earningsExcluded
        .map((e) => `${e.symbol} (${e.dateIso})`)
        .join(', ')}.`,
    );
  }

  const ranked = kept.sort((a, b) => b.rsScore - a.rsScore);

  /*
   * ## The option-quality gate, top ten only
   *
   * This is the one part of the scan that spends the Cboe quota, and the 08:30
   * gamma refresh has already spent most of the window. Ten chains is
   * affordable every day; fifty is not, and one per candidate would put the
   * run over on its own.
   *
   * So the ten strongest names that cleared all five gates are graded here,
   * and everything else is graded on demand through `/api/scanner/quality`.
   * Each result records which of the two it got, and the page says so — a
   * badge whose provenance is invisible is a badge the reader cannot weigh.
   *
   * Only names that actually passed are graded. Spending a chain on a name
   * that failed the trend gate buys nothing: it is not going on the list.
   */
  const toGrade = ranked
    .filter((row) => FILTER_KEYS.every((key) => row.single[key]?.state === 'pass'))
    .slice(0, OPTION_QUALITY_TOP_N);

  for (const row of toGrade) {
    row.optionQuality = await gradeSymbol(row.symbol, row.earnings, 'scan');
  }

  if (toGrade.length > 0) {
    notes.push(
      `Option contracts were checked at scan time for the top ${toGrade.length} ranked name${toGrade.length === 1 ? '' : 's'}. The rest are checked when you open them, to stay inside the chain provider's daily window.`,
    );
  }

  const result: ScanResult = {
    date: scanDate,
    scannedAt: new Date().toISOString(),
    scheduledEt: tuning.scanTimeEt,
    rows: ranked,
    universe,
    candidates: candidates.length,
    rsMin: tuning.rsMin,
    spyRegime: spy?.regime ?? null,
    gateReason,
    gammaDate: gamma?.date ?? null,
    gammaRefreshedAt: gamma?.refreshedAt ?? null,
    barFailures,
    barSkipped: outcome.skipped,
    earningsExcluded,
    earningsSource: earnings.source,
    qualityChecked: toGrade.length,
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

  /*
   * The archive is written on every path, including the mornings that produce
   * nothing. A run-rate that silently skipped its zeros would answer "how many
   * names pass on the days when names pass", which is not a question anyone
   * has — and would flatter the rule set on exactly the days it is doing its
   * job. See `archive.ts`; it never throws.
   */
  await archiveScan(result);

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
