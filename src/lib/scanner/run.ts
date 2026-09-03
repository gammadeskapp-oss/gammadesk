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
import { readTodaysGamma } from './gamma';
import { gradeSymbol } from './optionChain';
import {
  DEFAULT_FILTERS,
  excludedByEarnings,
  scoreRow,
  type MarketContext,
} from './score';
import {
  EARNINGS_EXCLUSION_DAYS,
  type GammaEntry,
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
export async function scanCandidates(): Promise<{ rows: RsRow[]; universe: number }> {
  const rs = await getRsResult(DEFAULT_WEIGHTS, DEFAULT_MIN_DOLLAR_VOLUME);
  return {
    rows: [...rs.rows].sort((a, b) => b.score - a.score),
    universe: rs.universe,
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

  const [{ rows: ranked, universe }, averages, gamma] = await Promise.all([
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
  } else if (gamma.failures.length > 0) {
    notes.push(
      `${gamma.failures.length} chains could not be read at ${tuning.gammaTimeEt} ET: ${gamma.failures
        .map((f) => f.symbol)
        .join(', ')}. Those names carry no dealer-positioning context and no option-liquidity reading, so both components are left out of their blend rather than scored zero.`,
    );
  }

  // --- score every name ------------------------------------------------------

  const rows: ScanRow[] = [];
  let missingAverages = 0;

  for (const row of ranked) {
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

  if (lookedUp.length < rows.length) {
    notes.push(
      `Earnings dates were looked up for the top ${lookedUp.length} names by score. The remaining ${rows.length - lookedUp.length} carry an unknown date, which never clears a name and never removes one — their watch lines say so. The calendar is batched fifty symbols at a time and the whole index is eleven sequential round trips, which is enough to push the run past its time limit and store nothing.`,
    );
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

  // --- the contract check ----------------------------------------------------

  /*
   * ## Who gets a chain pulled
   *
   * The top `contractTopN` by score, and nothing else. That used to be a
   * circular decision — contract quality was a scoring component, so the score
   * chose who was graded and the grade changed the score, and it took two
   * passes to settle. The contract is a filter now: it can mark a row red and
   * put a caution on its watch line, and it cannot move a name up or down the
   * ranking. One ordering, computed once, before any request is spent.
   *
   * Names already carrying a report inside the shipped buffer are skipped:
   * spending a chain to grade a contract on a name the default earnings buffer
   * removes buys nothing. They read "not checked", which is true.
   */
  const excludedSymbols = new Set(earningsExcluded.map((e) => e.symbol));

  const toGrade = ordered
    .filter((row) => !excludedSymbols.has(row.symbol))
    .slice(0, tuning.contractTopN);

  const qualityFailures: string[] = [];
  const bySymbol = new Map(toGrade.map((row) => [row.symbol, row]));

  /*
   * In waves, not one at a time.
   *
   * The constraint on Cboe is a quota per window rather than a rate, so
   * concurrency spends no more requests than a sequential loop does — it just
   * finishes. Graded serially, twenty-five chains took the run past the
   * platform's five-minute function ceiling on its own, which would have meant
   * the scan being killed mid-write and storing nothing at all.
   *
   * The budget is a backstop and it is deliberately short of the ceiling:
   * stopping cleanly with some names ungraded stores a usable scan that says
   * which ones it did not reach, and an ungraded contract already has an
   * honest rendering. Being killed at the ceiling stores nothing.
   */
  const gradeOutcome = await runScan(
    toGrade.map((row) => row.symbol),
    async (symbol) => {
      const row = bySymbol.get(symbol)!;
      try {
        row.optionQuality = await gradeSymbol(symbol, row.earnings, 'scan');
      } catch {
        /*
         * A chain that did not answer leaves the badge null, which renders
         * "contract not checked" in grey. Deliberately not a failed contract:
         * the provider being unavailable is not a fact about the stock, and
         * the one thing this page must never do is let a gap in the data read
         * as a bearish verdict.
         */
        qualityFailures.push(symbol);
      }
    },
    {
      concurrency: SCAN_CONCURRENCY,
      budgetMs: tuning.contractBudgetMs,
      maxRequests: toGrade.length,
    },
  );

  if (gradeOutcome.skipped.length > 0) {
    notes.push(
      `${gradeOutcome.skipped.length} contract check${gradeOutcome.skipped.length === 1 ? '' : 's'} were not reached before the time budget expired: ${gradeOutcome.skipped.join(', ')}. They read "contract not checked", which is what they are.`,
    );
  }

  const graded = toGrade.filter((row) => row.optionQuality !== null).length;

  if (qualityFailures.length > 0) {
    notes.push(
      `${qualityFailures.length} chain request${qualityFailures.length === 1 ? '' : 's'} failed: ${qualityFailures.join(', ')}. Those names show "contract not checked" rather than a failed contract — the provider being unavailable is not a fact about the stock.`,
    );
  }

  notes.push(
    `Option contracts were checked at scan time for the top ${graded} name${graded === 1 ? '' : 's'} by score, out of ${rows.length} scored. Everything below that reads "contract not checked" in grey until you open it — that is unknown, not failed. Raising the relative-strength cutoff or any other control can bring an unchecked name into view; its contract rule stays grey until it is checked.`,
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
    earningsSource: earnings.source,
    qualityChecked: graded,
    qualityTargeted: toGrade.length,
    qualityFailures,
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
