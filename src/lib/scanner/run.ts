import 'server-only';

import { config } from '../config';
import { createJsonStore } from '../jsonStore';
import { getRsResult } from '../rs';
import { DEFAULT_MIN_DOLLAR_VOLUME, DEFAULT_WEIGHTS, type RsRow } from '../rs/types';
import { runScan, SCAN_CONCURRENCY } from '../scanUniverse';
import { marketToday } from '../time';
import { archiveScan } from './archive';
import { readMovingAverages } from './averages';
import { readExtension } from './evaluate';
import { lookupEarnings } from './earnings';
import { readTodaysEarnings } from './earningsStore';
import { readTodaysGamma } from './gamma';
import { gradeSymbol } from './optionChain';
import {
  DEFAULT_FILTERS,
  excludedByEarnings,
  scoreRow,
  trendScore,
  type MarketContext,
} from './score';
import {
  EARNINGS_EXCLUSION_DAYS,
  type GammaEntry,
  type ScanCoverage,
  type LiquidityTier,
  type RowMetrics,
  type ScanResult,
  type ScanRow,
  type StoredScans,
} from './types';

/**
 * The 9:35 ET scan.
 *
 * ## It scores the index; it does not shortlist it
 *
 * The old pipeline ran the relative-strength floor first and everything
 * downstream saw only its survivors — about twenty-seven names — because each
 * survivor cost three upstream bar series and fifty of those was already the
 * affordable limit. That had two consequences worth naming, because both are
 * fixed here:
 *
 *  1. The floor could never be one of the reader's controls. Lowering it in
 *     the browser would have meant re-running the pipeline, so it was frozen
 *     into the run.
 *  2. Every rule after it AND-ed against the others, and the page printed only
 *     what survived all of them. Twice in a row that was nothing, and a page
 *     showing nothing cannot tell you which rule ate the list.
 *
 * So the bar phase is gone. Every reading a rule needs — the 200-day and
 * 20-day averages, the volume ratio, the turnover — is already in the
 * relative-strength digest, which is stored and read on every page view
 * anyway. That makes scoring all five hundred names cost **zero** upstream
 * requests, and it means the stored snapshot carries the whole index, which is
 * what the browser then filters against.
 *
 * ## The one thing that still costs requests
 *
 * Option chains. Cboe answers a limited number per window and the 08:30 gamma
 * job has already spent most of it, so contracts are graded for the top
 * `config.scanner.contractTopN` by score and nothing else. An ungraded
 * contract is *unknown*, never failed — see `contractVerdict` in `score.ts`.
 */

/**
 * Documents written before the rebuild are dropped on read, not migrated.
 *
 * The old shape stored *resolved verdicts* against cutoffs baked into the run,
 * and carried no `metrics`. There is nothing to migrate to: the readings the
 * new page filters on were never written down, so a converted document would
 * have to invent them or render every rule as unknown. Either would put a list
 * on screen under today's heading that no scan actually produced.
 *
 * Dropping them means the page says "today's scan has not run" until the next
 * one does, which is a true statement it already knows how to render. The
 * store keeps five days, so this self-clears within a week of deploying.
 */
function isCurrentShape(scan: unknown): boolean {
  if (!scan || typeof scan !== 'object') return false;
  const rows = (scan as ScanResult).rows;
  if (!Array.isArray(rows)) return false;
  // An empty scan is a legitimate document and cannot be sampled, so it is
  // judged on a field only the new writer sets.
  if (rows.length === 0) return typeof (scan as ScanResult).scored === 'number';
  return !!rows[0] && typeof rows[0] === 'object' && 'metrics' in rows[0];
}

const scanStore = createJsonStore<StoredScans>(
  'gammadesk/scanner-scans.json',
  () => ({ scans: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const scans = (raw as StoredScans).scans;
    if (!Array.isArray(scans)) return null;
    return { scans: scans.filter(isCurrentShape) };
  },
);

// --- liquidity tiers ---------------------------------------------------------

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
 * other.
 *
 * Only available for names the 08:30 job pulled a chain for, which is the
 * RS-clearing shortlist and not the index. It is context on the row rather
 * than part of the liquidity rule for exactly that reason: a rule that could
 * only be answered for a twentieth of the names it is applied to would report
 * `unknown` for everyone else and drag the whole list down a stage of the
 * funnel for reasons that have nothing to do with the stocks.
 */
function optionsTierOf(entry: GammaEntry): LiquidityTier {
  const tuning = config.tradeability;
  const byVolume = tierOf(entry.optionsVolume, tuning.optionsVolume);
  const byOi = tierOf(entry.optionsOpenInterest, tuning.optionsOpenInterest);
  return TIER_RANK[byVolume] <= TIER_RANK[byOi] ? byVolume : byOi;
}

// --- readings ----------------------------------------------------------------

/** Percent of `reference` that `value` sits above it. Null-safe both ways. */
function pctAbove(value: number | null, reference: number | null | undefined): number | null {
  if (value === null || reference === null || reference === undefined) return null;
  if (!(reference > 0) || !Number.isFinite(value)) return null;
  return ((value - reference) / reference) * 100;
}

/**
 * Every ranked name in the index, strongest first.
 *
 * No floor is applied. `getRsResult` still drops names under its own $10M/day
 * turnover floor before ranking — that one is structural, because percentiles
 * are only meaningful against a fixed pool — but nothing here narrows further.
 */
export async function scanCandidates(): Promise<{
  rows: RsRow[];
  universe: number;
  /** Ranked names with history but no usable stored bars yet. */
  pending: number;
  /** Names the ranking engine's own turnover floor removed from the pool. */
  illiquid: number;
}> {
  const rs = await getRsResult(DEFAULT_WEIGHTS, DEFAULT_MIN_DOLLAR_VOLUME);
  return {
    rows: [...rs.rows].sort((a, b) => b.score - a.score),
    universe: rs.universe,
    pending: rs.pending,
    illiquid: rs.illiquid,
  };
}

/**
 * Run the scan and store it.
 *
 * ## Nothing short-circuits any more
 *
 * The old run bailed out before the bar phase whenever SPY's gamma was
 * negative, on the grounds that every name would fail the market gate anyway.
 * The market gate is gone — it is a banner — so there is nothing to bail out
 * of, and on a volatile morning the page now shows the same ranked list with
 * the regime stated across the top of it. See `MARKET_REGIME_NOTE`.
 */
export async function runScanner(): Promise<ScanResult> {
  const tuning = config.scanner;
  const scanDate = marketToday();

  const [{ rows: ranked, universe, pending, illiquid }, averages, gamma] = await Promise.all([
    scanCandidates(),
    readMovingAverages(),
    readTodaysGamma(),
  ]);

  const spy = gamma?.symbols.SPY;
  /*
   * The one market-wide reading a score needs, resolved once. It is a
   * parameter to `scoreRow` rather than a field on every row: SPY's regime is
   * a single fact, and copying it onto 503 rows would create 503 chances for
   * it to disagree with itself.
   */
  const market: MarketContext = { spyRegime: spy?.regime ?? null };
  const notes: string[] = [];

  if (!gamma) {
    notes.push(
      `No same-day gamma refresh was found, so the market regime is unknown and no name carries its own dealer positioning. The ${tuning.gammaTimeEt} ET job either has not run or could not store its result. The nightly cache is deliberately not used as a substitute — it can be four days old. Nothing is dropped for this: the regime is one component of seven and one optional filter, and an unmeasured component is left out of the blend rather than scored zero.`,
    );
  } else {
    /*
     * The full list of names with no chain, not just the ones that errored.
     *
     * `failures` are the chains that threw; `skipped` are the ones abandoned at
     * the per-symbol deadline or past the budget. Both leave the name with no
     * dealer-positioning reading, and the note used to list only `failures` —
     * so a name that timed out (the common case on a slow morning) was missing
     * from the page's own account of what it could not read. Every name without
     * a chain is named here now.
     */
    const noChain = [
      ...gamma.failures.map((f) => f.symbol),
      ...gamma.skipped,
    ].sort();
    if (noChain.length > 0) {
      notes.push(
        `${noChain.length} chain${noChain.length === 1 ? '' : 's'} could not be read at ${tuning.gammaTimeEt} ET: ${noChain.join(', ')}. Those names carry no dealer-positioning context and no option-liquidity reading, so both components are left out of their blend rather than scored zero.`,
      );
    }
  }

  // --- score every name ------------------------------------------------------

  const rows: ScanRow[] = [];
  let missingAverages = 0;
  /*
   * The only exclusion this loop performs.
   *
   * A name with no close cannot be scored on anything — every component is
   * measured against price — and it cannot be priced into the track record
   * either. Everything else that might be missing (an average, the VWAP, a
   * volume baseline, a chain) leaves that one component unmeasured and the
   * name in the list, because a reading nobody took is not a reading that
   * came back badly.
   */
  const droppedNoPrice: string[] = [];

  for (const row of ranked) {
    if (row.close === null || !Number.isFinite(row.close) || row.close <= 0) {
      droppedNoPrice.push(row.symbol);
      continue;
    }

    const ma = averages.bySymbol.get(row.symbol);
    const ema200 = ma?.ema200 ?? null;
    const ema50 = ma?.ema50 ?? null;
    const ema20 = ma?.ema20 ?? null;
    const vwap20 = ma?.vwap20 ?? null;
    if (ema200 === null) missingAverages += 1;

    const entry = gamma?.symbols[row.symbol];

    const metrics: RowMetrics = {
      rsScore: row.score,
      rsRank: row.rank,
      // Straight off the RS engine. A percentile is a property of the pool, so
      // it is the one trend input that cannot be recomputed from this name's
      // own numbers.
      m1Percentile: row.percentiles.m1,
      pctAbove200: pctAbove(row.close, ema200),
      ema200,
      pctAbove50: pctAbove(row.close, ema50),
      ema50,
      pctAbove20: pctAbove(row.close, ema20),
      ema20,
      volumeRatio: row.volumeRatio,
      avgDollarVolume: row.avgDollarVolume,
      vwap20,
      pctAboveVwap: pctAbove(row.close, vwap20),
    };

    rows.push({
      symbol: row.symbol,
      price: row.close,
      priceAsOf: row.asOfDate,
      metrics,
      equityTier: tierOf(row.avgDollarVolume, config.tradeability.equityDollarVolume),
      optionsTier: entry ? optionsTierOf(entry) : null,
      regime: entry?.regime ?? null,
      netGex: entry?.netGex ?? null,
      magnets: entry?.magnets ?? [],
      optionsVolume: entry?.optionsVolume ?? null,
      optionsOpenInterest: entry?.optionsOpenInterest ?? null,
      // Filled in below: the earnings lookup is batched across the whole list,
      // not run once per name.
      earnings: { state: 'unknown', dateIso: null, daysAway: null, source: 'not looked up' },
      extension: readExtension(row.close, ema20),
      optionQuality: null,
    });
  }

  if (averages.computed > 0) {
    notes.push(
      `The 200-day average was recomputed from stored price history for ${averages.computed} name${averages.computed === 1 ? '' : 's'}, because the relative-strength digest does not carry one for them yet. It is the same calculation on the same closes, and it costs no upstream request. Waiting for the digest to fill in would have read as "no trend reading" for those names, which is not what the price history says.`,
    );
  }

  if (missingAverages > 0) {
    notes.push(
      `${missingAverages} of ${rows.length} names have too little price history for a 200-day average, so that part of their trend score is left out rather than counted against them. A recent listing does not have two hundred sessions behind it, and reporting that as "below its 200-day average" would be a claim about the market assembled out of a gap in the data.`,
    );
  }

  // --- earnings --------------------------------------------------------------

  /*
   * One batched lookup across the whole scored list. See `earnings.ts` for why
   * this is Tradier's fundamentals calendar and not the macro calendar in
   * `lib/events`, which carries no per-company dates.
   *
   * Names are no longer *removed* here. The buffer is one of the reader's
   * controls, so the date is stored on the row and the exclusion is applied in
   * the browser at whatever buffer is set — a name dropped at scan time could
   * not come back when the reader moved the control to zero. `earningsExcluded`
   * below records who would go at the shipped ten-day default, for the archive
   * and the run summary.
   *
   * A name whose date could not be established is kept, with the uncertainty
   * on its watch line. `excludedByEarnings` reads the state rather than the day
   * count precisely so that unknown can never be mistaken for far-away.
   */
  const ordered = [...rows]
    .map((row) => ({ row, score: scoreRow(row, market).total }))
    .sort((a, b) => b.score - a.score || a.row.symbol.localeCompare(b.row.symbol))
    .map(({ row }) => row);

  /*
   * Earnings come from the 09:00 ET step's store when it has run today — it
   * looks up the whole index, so every scored name carries a real date. When it
   * has not run (a cold morning, or the step failed its retries), the scan
   * falls back to its own inline lookup of the top names so nothing regresses:
   * the names below the fallback cutoff read `unknown`, which never clears a
   * name and never removes one.
   */
  const storedEarnings = await readTodaysEarnings();
  let earningsSourceLine: string;

  if (storedEarnings) {
    for (const row of rows) {
      row.earnings = storedEarnings.bySymbol.get(row.symbol) ?? {
        state: 'unknown',
        dateIso: null,
        daysAway: null,
        source: 'not present in the earnings step result',
      };
    }
    earningsSourceLine = storedEarnings.source;
    notes.push(
      `Earnings dates for all ${rows.length} scored names came from the 09:00 ET earnings step. ${storedEarnings.source}`,
    );
  } else {
    const lookedUp = ordered.slice(0, tuning.earningsLookupN);
    const earnings = await lookupEarnings(lookedUp.map((r) => r.symbol), scanDate);
    for (const row of rows) {
      row.earnings = earnings.bySymbol.get(row.symbol) ?? {
        state: 'unknown',
        dateIso: null,
        daysAway: null,
        source: `outside the top ${tuning.earningsLookupN} by score, so no date was requested`,
      };
    }
    earningsSourceLine = earnings.source;
    if (lookedUp.length < rows.length) {
      notes.push(
        `The 09:00 ET earnings step has not stored a result for today, so the scan looked up the top ${lookedUp.length} names by score inline. The remaining ${rows.length - lookedUp.length} carry an unknown date, which never clears a name and never removes one — their watch lines say so.`,
      );
    }
  }

  const earningsExcluded: ScanResult['earningsExcluded'] = [];
  for (const row of rows) {
    if (
      excludedByEarnings(row, EARNINGS_EXCLUSION_DAYS) &&
      row.earnings.dateIso &&
      row.earnings.daysAway !== null
    ) {
      earningsExcluded.push({
        symbol: row.symbol,
        dateIso: row.earnings.dateIso,
        daysAway: row.earnings.daysAway,
      });
    }
  }

  // --- the contract check: targeted here, graded in the 09:40 step -----------

  /*
   * ## Who gets a chain pulled — decided here, pulled later
   *
   * The top `contractTopN` by score, minus the names the default earnings
   * buffer already removes (spending a chain to grade a name that is reporting
   * this week buys nothing). The scan only *decides* the target set; the chains
   * themselves are pulled by the separate 09:40 ET contracts step —
   * `gradeStoredScanContracts` below — so the scan finishes in seconds and the
   * slower, quota-sensitive chain pulls get their own function invocation and
   * can be retried without re-running the whole scan.
   *
   * Until that step runs, every contract reads "not checked" in grey, which is
   * unknown and not failed — exactly how it read before, just filled in a few
   * minutes later instead of inside this run.
   */
  const excludedSymbols = new Set(earningsExcluded.map((e) => e.symbol));

  const toGrade = ordered
    .filter((row) => !excludedSymbols.has(row.symbol))
    .slice(0, tuning.contractTopN);

  const qualityFailures: string[] = [];
  const graded = 0;

  notes.push(
    `Option contracts are checked for the top ${toGrade.length} name${toGrade.length === 1 ? '' : 's'} by score (of ${rows.length} scored) by the 09:40 ET contracts step. Until it runs, and for everything below the top ${toGrade.length}, the contract rule reads "contract not checked" in grey — unknown, not failed.`,
  );

  /*
   * The stored document is written in score order, so a reader opening the raw
   * JSON sees the same ranking the page does.
   *
   * `ordered` is that order and it was fixed before any chain was pulled.
   * There is no second scoring pass any more: the contract grade filters and
   * cautions but no longer scores, so grading a name cannot move it, and the
   * circularity where the score chose who got graded and the grade changed the
   * score is simply gone.
   */
  const scored = ordered;

  /*
   * ## The count, assembled and printed
   *
   * One line, every run, naming what entered scoring, what came out, and how
   * much of the list each reading actually covered. It is the answer to "why
   * is this page showing thirty names", and it costs nothing.
   *
   * `entered` and `exited` differing by anything other than `droppedNoPrice`
   * would be a bug in the loop above, which is why both are recorded rather
   * than one being inferred from the other.
   */
  const coverage: ScanCoverage = {
    universe,
    entered: ranked.length,
    exited: scored.length,
    droppedNoPrice,
    notRanked: { pending, illiquid },
    withGamma: scored.filter((row) => row.regime !== null).length,
    withOptionLiquidity: scored.filter(
      (row) => row.optionsVolume !== null && row.optionsOpenInterest !== null,
    ).length,
    withTrend: scored.filter((row) => trendScore(row.metrics).value !== null).length,
    withVwap: scored.filter((row) => row.metrics.pctAboveVwap !== null).length,
    withVolume: scored.filter((row) => row.metrics.volumeRatio !== null).length,
    gammaSource: gamma?.source ?? 'none — no same-day gamma document',
  };

  console.log(
    `[scanner] universe=${coverage.universe} entered=${coverage.entered} exited=${coverage.exited} ` +
      `droppedNoPrice=${droppedNoPrice.length} notRanked=${pending}pending/${illiquid}illiquid ` +
      `gamma=${coverage.withGamma}/${coverage.exited} optionLiquidity=${coverage.withOptionLiquidity} ` +
      `trend=${coverage.withTrend} vwap=${coverage.withVwap} volume=${coverage.withVolume} ` +
      `gammaSource=${coverage.gammaSource}`,
  );

  if (coverage.entered < coverage.universe) {
    notes.push(
      `${coverage.entered} of ${coverage.universe} names in the index were ranked and scored. The other ${coverage.universe - coverage.entered} were not: ${pending} have no usable stored price history yet — the nightly job builds it a quarter of the index at a time — and ${illiquid} sit below the ranking engine's own $10M-a-day turnover floor, which fixes the pool the percentiles are measured against. Neither is a judgement about the stock, and neither is hidden: the header states the number actually scored rather than the size of the index.`,
    );
  }

  if (droppedNoPrice.length > 0) {
    notes.push(
      `${droppedNoPrice.length} ranked name${droppedNoPrice.length === 1 ? '' : 's'} had no usable close and could not be scored on anything: ${droppedNoPrice.join(', ')}. That is the only reason this run drops a name — every other missing reading leaves the component unmeasured and the name on the list.`,
    );
  }

  if (coverage.withGamma < coverage.exited) {
    notes.push(
      `Dealer positioning was read for ${coverage.withGamma} of the ${coverage.exited} scored names (source: ${coverage.gammaSource}). The rest carry no gamma and no option-liquidity reading — both components are left out of their blend rather than scored zero, and neither absence counts against a name when the gamma or market filter is switched on. A filter cannot fail a name it was never able to test.`,
    );
  }

  const result: ScanResult = {
    date: scanDate,
    scannedAt: new Date().toISOString(),
    scheduledEt: tuning.scanTimeEt,
    rows: scored,
    universe,
    scored: scored.length,
    rsMin: DEFAULT_FILTERS.rsMin,
    spyRegime: market.spyRegime,
    gammaDate: gamma?.date ?? null,
    gammaRefreshedAt: gamma?.refreshedAt ?? null,
    earningsExcluded,
    earningsSource: earningsSourceLine,
    qualityChecked: graded,
    qualityTargeted: toGrade.length,
    qualityFailures,
    coverage,
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
   * nothing at the default settings. A run-rate that silently skipped its
   * zeros would answer "how many names pass on the days when names pass",
   * which is not a question anyone has. See `archive.ts`; it never throws.
   */
  await archiveScan(result);

  return result;
}

export interface ContractsStepOutcome {
  /** Null when there was no stored scan to grade. */
  date: string | null;
  targeted: number;
  graded: number;
  failures: string[];
  skipped: string[];
}

/**
 * The 09:40 ET contracts step: grade the top names' option chains and write the
 * grades back onto today's stored scan.
 *
 * ## Separate from the scan on purpose
 *
 * Pulling option chains is the slow, quota-sensitive half of the morning, and
 * running it inside the scan made the scan risk the platform's function ceiling
 * — a single unlucky run would be killed mid-write and store nothing. As its
 * own step it has a whole invocation to itself, it can be retried without
 * re-scoring the index, and a scan with no grades yet is already a correct page
 * (every contract reads "not checked" in grey until this fills them in).
 *
 * Idempotent: if the stored scan already has grades, it does nothing. Never
 * throws — a chain that will not answer leaves its badge grey, which is unknown
 * and not failed.
 */
export async function gradeStoredScanContracts(): Promise<ContractsStepOutcome> {
  const tuning = config.scanner;
  const stored = await scanStore.read().catch(() => null);
  const today = marketToday();
  const scan = stored?.scans.find((s) => s.date === today) ?? null;

  if (!scan) return { date: null, targeted: 0, graded: 0, failures: [], skipped: [] };

  const excluded = new Set(scan.earningsExcluded.map((e) => e.symbol));
  // The stored rows are already in score order, so "top N" is just the slice.
  const toGrade = scan.rows
    .filter((row) => !excluded.has(row.symbol))
    .slice(0, tuning.contractTopN);

  // Already graded (a prior tick did it): nothing to do.
  if (scan.qualityChecked > 0 && toGrade.every((row) => row.optionQuality !== null)) {
    return {
      date: today,
      targeted: toGrade.length,
      graded: scan.qualityChecked,
      failures: scan.qualityFailures,
      skipped: [],
    };
  }

  const failures: string[] = [];
  const bySymbol = new Map(toGrade.map((row) => [row.symbol, row]));

  const outcome = await runScan(
    toGrade.map((row) => row.symbol),
    async (symbol) => {
      const row = bySymbol.get(symbol)!;
      try {
        row.optionQuality = await gradeSymbol(symbol, row.earnings, 'scan');
      } catch {
        failures.push(symbol);
      }
    },
    {
      concurrency: SCAN_CONCURRENCY,
      budgetMs: tuning.contractBudgetMs,
      maxRequests: toGrade.length,
    },
  );

  const graded = toGrade.filter((row) => row.optionQuality !== null).length;

  // Rebuild the contract notes on the stored scan: drop the "checked by the
  // 09:40 step" placeholder the scan wrote, and record what actually happened.
  const notes = scan.notes.filter(
    (n) => !n.startsWith('Option contracts are checked for the top'),
  );
  notes.push(
    `Option contracts were checked for the top ${graded} name${graded === 1 ? '' : 's'} by score, out of ${scan.scored} scored. Everything below reads "contract not checked" in grey — unknown, not failed.`,
  );
  if (outcome.skipped.length > 0) {
    notes.push(
      `${outcome.skipped.length} contract check${outcome.skipped.length === 1 ? '' : 's'} were not reached before the time budget expired: ${outcome.skipped.join(', ')}. They read "contract not checked".`,
    );
  }
  if (failures.length > 0) {
    notes.push(
      `${failures.length} chain request${failures.length === 1 ? '' : 's'} failed: ${failures.join(', ')}. Those names show "contract not checked" rather than a failed contract.`,
    );
  }

  const updated: ScanResult = {
    ...scan,
    qualityChecked: graded,
    qualityFailures: failures,
    notes,
  };

  try {
    await scanStore.update((current) => ({
      scans: current.scans.map((s) => (s.date === today ? updated : s)),
    }));
  } catch {
    // Leave the scan as it was; the grades were computed but not persisted, and
    // the next tick retries.
  }

  // Re-archive so the day's record carries the contract grades rather than the
  // grey placeholders the scan step archived.
  await archiveScan(updated);

  return {
    date: today,
    targeted: toGrade.length,
    graded,
    failures,
    skipped: outcome.skipped,
  };
}

/**
 * Today's stored scan, or null.
 *
 * Never falls back to a previous day. Yesterday's list under today's heading is
 * the exact failure this whole page is arranged to prevent, and "no scan yet
 * today" is a real answer the page can render.
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
