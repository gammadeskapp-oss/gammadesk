import 'server-only';

import { createJsonStore } from '../jsonStore';
import { runScan } from '../scanUniverse';
import { ema, rsi } from '../ticker/indicators';
import { addDays, marketToday } from '../time';
import { fetchBars, type DailyBar } from './history';
import { getMembership } from './membership';
import {
  LIQUIDITY_WINDOW,
  RSI_PERIOD,
  RS_SCHEMA,
  TREND_LOOKBACK,
  VOLUME_BASELINE,
  VOLUME_RECENT,
  WINDOWS,
  type BarShard,
  type DigestEntry,
  type DigestShard,
  type RsMeta,
} from './types';
import { SHARDS, shardSymbols } from './universe';

/**
 * The nightly job that keeps the price history current.
 *
 * ## One shard per run
 *
 * Ten years of daily closes for five hundred symbols is far too much to read,
 * merge and rewrite inside a sixty-second function, and fetching all five
 * hundred at once is exactly what the rate limits do not allow. So the
 * universe is split into four shards by a hash of the symbol, and a run takes
 * exactly one of them — around 125 symbols. Four cron firings an evening cover
 * the whole index, and any single run stays well inside its budget.
 *
 * ## Three fetch depths
 *
 * Symbols are not all worth the same request:
 *
 * - **new** (nothing stored): two years. Enough to be ranked on all three
 *   windows immediately, and a fraction of the payload of a ten-year pull.
 *   Getting a name onto the page matters more than its 2017 prices.
 * - **deepening** (stored, but short of the full history): ten years, capped
 *   at `MAX_DEEPEN` per run. This is the gradual backfill — it costs a few
 *   large responses a night and converges over a couple of weeks without ever
 *   making one run expensive.
 * - **current** (stored and deep): one year. Refreshes the tail and gives a
 *   long overlap for the split check below.
 *
 * ## Splits
 *
 * Yahoo returns split-adjusted closes, so the day after a 2-for-1 split every
 * historical close it serves is half what we stored. Stitching a new tail onto
 * an unadjusted history would leave a 50% cliff in the middle of the series and
 * hand that stock a catastrophic six-month return. The merge therefore compares
 * the two versions across the dates they share and, when they disagree by a
 * consistent factor, rescales the older portion by it. The median across a
 * year of overlapping sessions is what makes this safe: a genuine split moves
 * every overlapping date by the same ratio, while noise does not move the
 * median at all.
 */

/** Years of history the store aims to hold per symbol. */
const MAX_YEARS = 10;
/** Bars below which a symbol is still considered to be backfilling. */
const DEEP_BARS = 1200;
/** Full ten-year pulls allowed per run, so one run is never dominated by them. */
const MAX_DEEPEN = 25;
/** Yahoo absorbed twenty concurrent requests comfortably; ten leaves headroom. */
const CONCURRENCY = 10;
/** Wall-clock budget. The route is capped at 60s; stopping at 40 leaves room to write. */
const BUDGET_MS = 40_000;

/**
 * Sessions a symbol needs before it can be ranked at all.
 *
 * The shortest window is 21 sessions, and the trend read looks back another 5,
 * so 27 bars is the floor for producing any score. Names below it are reported
 * as pending rather than ranked.
 */
const MIN_BARS = WINDOWS.m1 + TREND_LOOKBACK + 1;

/**
 * The two moving-average periods stored in the digest for /movers.
 *
 * Read from `types.ts` would be circular-ish and these are not tunable: they
 * match the scanner's fixed extended flag (20) and its default trend gate
 * (200) on purpose. See the note on `DigestEntry.ema20`.
 */
const EMA_SHORT = 20;
const EMA_LONG = 200;

// --- stores -------------------------------------------------------------------

function barStore(shard: number) {
  return createJsonStore<BarShard | null>(
    `gammadesk/rs-bars-${shard}.json`,
    () => null,
    (raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const doc = raw as BarShard;
      if (doc.schema !== RS_SCHEMA) return null;
      if (!Array.isArray(doc.dates) || !doc.closes || !doc.volumes) return null;
      return doc;
    },
  );
}

export function digestStore(shard: number) {
  return createJsonStore<DigestShard | null>(
    `gammadesk/rs-digest-${shard}.json`,
    () => null,
    (raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const doc = raw as DigestShard;
      if (doc.schema !== RS_SCHEMA) return null;
      if (!Array.isArray(doc.entries)) return null;
      return doc;
    },
  );
}

export const metaStore = createJsonStore<RsMeta>(
  'gammadesk/rs-meta.json',
  () => ({ schema: RS_SCHEMA, cursor: 0, ranAt: {}, notes: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as RsMeta;
    if (doc.schema !== RS_SCHEMA) return null;
    return doc;
  },
);

// --- merging ------------------------------------------------------------------

/**
 * The factor the upstream has applied to history since we last stored it.
 *
 * Returns 1 when the two agree, which is the overwhelmingly common case.
 * Compares only dates present on both sides, and takes the median so that one
 * corrected bad print cannot rescale a decade of prices.
 */
function adjustmentFactor(
  storedDates: string[],
  storedCloses: (number | null)[],
  incoming: DailyBar[],
): number {
  const fresh = new Map(incoming.map((b) => [b.date, b.close]));
  const ratios: number[] = [];

  for (let i = 0; i < storedDates.length; i += 1) {
    const was = storedCloses[i];
    const now = fresh.get(storedDates[i]);
    if (was === null || was === undefined || !now || was <= 0) continue;
    ratios.push(now / was);
  }

  // A handful of overlapping days is not enough to tell a split from a data
  // correction, so leave the history alone and let the next run decide.
  if (ratios.length < 20) return 1;

  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];

  // Below 5% this is dividend and rounding noise, not a corporate action.
  if (!Number.isFinite(median) || median <= 0 || Math.abs(median - 1) < 0.05) return 1;
  return median;
}

interface MergeResult {
  doc: BarShard;
  adjusted: string[];
}

/**
 * Fold this run's fetches into the shard document.
 *
 * Rebuilt around a fresh union of dates rather than appended in place, because
 * a symbol that listed last month introduces dates the shard already has and a
 * symbol fetched for ten years introduces dates it does not.
 */
function merge(
  previous: BarShard | null,
  shard: number,
  fetched: Map<string, DailyBar[]>,
  keepSymbols: Set<string>,
): MergeResult {
  const cutoff = addDays(marketToday(), -Math.ceil(MAX_YEARS * 365.25));

  const oldDates = previous?.dates ?? [];
  const oldCloses = previous?.closes ?? {};

  // Union of every date still in range, from both sides.
  const dateSet = new Set<string>();
  for (const d of oldDates) if (d >= cutoff) dateSet.add(d);
  for (const bars of fetched.values()) {
    for (const b of bars) if (b.date >= cutoff) dateSet.add(b.date);
  }
  const dates = [...dateSet].sort();
  const position = new Map(dates.map((d, i) => [d, i]));

  const closes: Record<string, (number | null)[]> = {};
  const volumes: Record<string, (number | null)[]> = {};
  const fetchedAt: Record<string, string> = {};
  const adjusted: string[] = [];
  const now = new Date().toISOString();

  // Symbols that left the index are dropped here rather than kept forever:
  // their bars are dead weight, and if they return they simply backfill again.
  for (const symbol of keepSymbols) {
    const incoming = fetched.get(symbol);
    const storedRow = oldCloses[symbol];

    let factor = 1;
    if (storedRow && incoming) {
      factor = adjustmentFactor(oldDates, storedRow, incoming);
      if (factor !== 1) adjusted.push(symbol);
    }

    const row: (number | null)[] = new Array(dates.length).fill(null);
    const volumeRow: (number | null)[] = new Array(dates.length).fill(null);
    const storedVolumes = previous?.volumes?.[symbol];

    if (storedRow) {
      for (let i = 0; i < oldDates.length; i += 1) {
        const at = position.get(oldDates[i]);
        if (at === undefined) continue;

        const value = storedRow[i];
        if (value !== null && value !== undefined) row[at] = value * factor;

        // Volume moves inversely to price across a split, so that dollar
        // volume is continuous — the same rule `applySplits` follows.
        const volume = storedVolumes?.[i];
        if (volume !== null && volume !== undefined) volumeRow[at] = volume / factor;
      }
    }

    // Fetched values overwrite stored ones on shared dates — the upstream's
    // current view of a session is more correct than our copy of it.
    if (incoming) {
      for (const bar of incoming) {
        const at = position.get(bar.date);
        if (at === undefined) continue;
        row[at] = bar.close;
        volumeRow[at] = bar.volume;
      }
      fetchedAt[symbol] = now;
    } else if (previous?.fetchedAt?.[symbol]) {
      fetchedAt[symbol] = previous.fetchedAt[symbol];
    }

    if (row.some((v) => v !== null)) {
      closes[symbol] = row;
      volumes[symbol] = volumeRow;
    }
  }

  return {
    doc: { schema: RS_SCHEMA, shard, dates, closes, volumes, fetchedAt, updatedAt: now },
    adjusted,
  };
}

// --- digest -------------------------------------------------------------------

/**
 * Reduce one symbol's series to the numbers a ranking needs.
 *
 * Windows are counted in the symbol's *own* trading sessions, not in shard
 * calendar positions. For a name that was halted for three days, "one month"
 * then means 21 sessions it actually traded rather than 21 dates the rest of
 * the index traded — the return is measured over the same amount of trading
 * for every stock, which is what makes the percentile comparable.
 */
function digestFor(
  symbol: string,
  dates: string[],
  row: (number | null)[],
  volumeRow: (number | null)[] | undefined,
): DigestEntry | null {
  const series: number[] = [];
  const seriesDates: string[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < row.length; i += 1) {
    const v = row[i];
    if (v !== null && Number.isFinite(v) && v > 0) {
      series.push(v);
      seriesDates.push(dates[i]);
      const vol = volumeRow?.[i];
      volumes.push(typeof vol === 'number' && Number.isFinite(vol) && vol > 0 ? vol : 0);
    }
  }

  const n = series.length;
  if (n < MIN_BARS) return null;

  const last = n - 1;
  const back = last - TREND_LOOKBACK;

  const ret = (from: number, to: number): number | null =>
    from >= 0 && series[from] > 0 ? series[to] / series[from] - 1 : null;

  /*
   * Dollar volume, not share volume. A million shares of a $8 stock and a
   * million of an $800 one are wildly different amounts of tradeable
   * liquidity, and it is the dollars that decide whether a position can
   * actually be built.
   */
  const liquidityFrom = Math.max(0, n - LIQUIDITY_WINDOW);
  let dollars = 0;
  let counted = 0;
  for (let i = liquidityFrom; i <= last; i += 1) {
    if (volumes[i] > 0) {
      dollars += series[i] * volumes[i];
      counted += 1;
    }
  }
  const avgDollarVolume = counted > 0 ? dollars / counted : 0;

  /** Mean share volume over a slice, or null when the slice is short or empty. */
  const meanVolume = (from: number, to: number): number | null => {
    if (from < 0 || to <= from) return null;
    let sum = 0;
    let seen = 0;
    for (let i = from; i < to; i += 1) {
      if (volumes[i] > 0) {
        sum += volumes[i];
        seen += 1;
      }
    }
    // Require most of the window to be present, so a stretch of missing
    // volume cannot masquerade as a genuine collapse in trading.
    return seen >= (to - from) * 0.6 ? sum / seen : null;
  };

  /*
   * RSI over the symbol's own sessions, the same series the returns are
   * measured on — so a halted stock's RSI covers 14 days it actually traded
   * rather than 14 dates the rest of the index did. The last value is the only
   * one worth keeping; the rest of the curve belongs to the /ticker chart.
   */
  const rsiSeries = rsi(series, RSI_PERIOD);
  const rsiLast = rsiSeries[last];

  const recentFrom = n - VOLUME_RECENT;
  const recent = meanVolume(recentFrom, n);
  const baseline = meanVolume(recentFrom - VOLUME_BASELINE, recentFrom);

  /*
   * The two averages the movers list reads. Same series as everything above,
   * so a halted stock's 200-day average covers 200 sessions it actually
   * traded. `latestFinite` rather than a bare index because `ema` yields null
   * until its period is filled, and a symbol with 60 bars has no 200-day
   * average at all — which is reported as null, never as the 60-bar one.
   */
  const latestFinite = (series: (number | null)[]): number | null => {
    const value = series[series.length - 1];
    return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  };

  const ema20 = n >= EMA_SHORT ? latestFinite(ema(series, EMA_SHORT)) : null;
  const ema200 = n >= EMA_LONG ? latestFinite(ema(series, EMA_LONG)) : null;

  // Share volume over the same 20 sessions the dollar figure uses, so the two
  // never disagree about which window they cover.
  const avgVolume20 = meanVolume(Math.max(0, n - LIQUIDITY_WINDOW), n);

  return {
    symbol,
    asOfDate: seriesDates[last],
    close: series[last],
    changePct: n >= 2 ? series[last] / series[last - 1] - 1 : null,
    bars: n,
    returns: {
      m1: ret(last - WINDOWS.m1, last),
      m3: ret(last - WINDOWS.m3, last),
      m6: ret(last - WINDOWS.m6, last),
    },
    prior:
      back >= 0
        ? {
            m1: ret(back - WINDOWS.m1, back),
            m3: ret(back - WINDOWS.m3, back),
            m6: ret(back - WINDOWS.m6, back),
          }
        : { m1: null, m3: null, m6: null },
    avgDollarVolume,
    volumeRatio:
      recent !== null && baseline !== null && baseline > 0 ? recent / baseline : null,
    rsi14:
      rsiLast !== null && rsiLast !== undefined && Number.isFinite(rsiLast)
        ? rsiLast
        : null,
    ema20,
    ema200,
    avgVolume20,
  };
}

// --- the run ------------------------------------------------------------------

export interface RefreshReport {
  shard: number;
  symbols: number;
  fetched: number;
  failed: string[];
  skipped: string[];
  /** Symbols given a full ten-year pull this run. */
  deepened: string[];
  /** Symbols whose stored history was rescaled for a split. */
  adjusted: string[];
  ranked: number;
  pending: string[];
  asOfDate: string;
  nextShard: number;
  notes: string[];
}

/**
 * Refresh one shard: fetch, merge, digest, store.
 *
 * Which shard is taken from a stored cursor so successive cron firings walk
 * the whole universe. Pass `shard` explicitly only to force one.
 */
export async function refreshShard(shard?: number): Promise<RefreshReport> {
  const meta = await metaStore.read().catch(
    (): RsMeta => ({ schema: RS_SCHEMA, cursor: 0, ranAt: {}, notes: [] }),
  );
  const target = ((shard ?? meta.cursor) % SHARDS + SHARDS) % SHARDS;

  const membership = await getMembership();
  const symbols = shardSymbols(membership.members, target);
  const notes = [...membership.notes];

  const previous = await barStore(target).read().catch(() => null);
  const storedBars = (symbol: string): number =>
    previous?.closes?.[symbol]?.reduce<number>((n, v) => (v === null ? n : n + 1), 0) ?? 0;

  /*
   * Order the run so the cheap, high-value work happens first. Symbols with
   * nothing stored come first — they are the ones currently missing from the
   * page — then everything else. If the budget runs out mid-run, what gets
   * dropped is a tail refresh of a symbol that already has good data.
   */
  const ordered = [...symbols].sort((a, b) => {
    const rank = (s: string) => (storedBars(s) === 0 ? 0 : 1);
    return rank(a) - rank(b);
  });

  let deepenBudget = MAX_DEEPEN;
  const deepened: string[] = [];

  const depthFor = (symbol: string): number => {
    const held = storedBars(symbol);
    if (held === 0) return 2;
    if (held < DEEP_BARS && deepenBudget > 0) {
      deepenBudget -= 1;
      deepened.push(symbol);
      return MAX_YEARS;
    }
    return 1;
  };

  const fetched = new Map<string, DailyBar[]>();
  const failures = new Map<string, string>();

  const { skipped } = await runScan(
    ordered,
    async (symbol) => {
      try {
        const bars = await fetchBars(symbol, depthFor(symbol));
        if (bars) fetched.set(symbol, bars);
        else failures.set(symbol, 'Upstream has no price history for this symbol.');
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.set(symbol, `Fetch failed: ${detail}.`);
      }
      return symbol;
    },
    { concurrency: CONCURRENCY, budgetMs: BUDGET_MS, maxRequests: ordered.length },
  );

  const failed = [...failures.keys()];

  const { doc, adjusted } = merge(previous, target, fetched, new Set(symbols));

  const entries: DigestEntry[] = [];
  const pending: string[] = [];
  for (const symbol of symbols) {
    const row = doc.closes[symbol];
    const entry = row ? digestFor(symbol, doc.dates, row, doc.volumes[symbol]) : null;
    if (entry) entries.push(entry);
    else pending.push(symbol);
  }

  const digest: DigestShard = {
    schema: RS_SCHEMA,
    shard: target,
    entries,
    failures: [...failures.entries()].map(([symbol, reason]) => ({ symbol, reason })),
    computedAt: new Date().toISOString(),
  };

  try {
    await barStore(target).write(doc);
    await digestStore(target).write(digest);
    await metaStore.write({
      schema: RS_SCHEMA,
      cursor: (target + 1) % SHARDS,
      ranAt: { ...meta.ranAt, [String(target)]: digest.computedAt },
      notes: [],
    });
  } catch (error) {
    notes.push(
      `Shard ${target} was computed but could not be fully stored: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (adjusted.length > 0) {
    notes.push(
      `Rescaled stored history for a split or similar adjustment: ${adjusted.join(', ')}.`,
    );
  }
  /*
   * A handful of failures is normal — a delisting, a symbol the list has that
   * the upstream does not. Most of a shard failing is an outage, and it has to
   * say so: without this the page just shows a smaller index, which looks
   * entirely plausible and is completely wrong.
   */
  if (failed.length > symbols.length / 2) {
    notes.push(
      `${failed.length} of ${symbols.length} symbols in shard ${target} could not be fetched, which points at an upstream problem rather than the data. First error: ${
        [...failures.values()][0]
      }`,
    );
  }

  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} symbols in shard ${target} were not reached before the time budget ran out; the next run takes them first.`,
    );
  }

  return {
    shard: target,
    symbols: symbols.length,
    fetched: fetched.size,
    failed,
    skipped,
    deepened,
    adjusted,
    ranked: entries.length,
    pending,
    asOfDate: entries.reduce((max, e) => (e.asOfDate > max ? e.asOfDate : max), ''),
    nextShard: (target + 1) % SHARDS,
    notes,
  };
}

/** Covered symbols per shard, for the health check. */
export { barStore };
export const RS_LIMITS = { MAX_YEARS, DEEP_BARS, MAX_DEEPEN, CONCURRENCY, MIN_BARS };
