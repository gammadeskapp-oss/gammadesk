import { GROUPS } from '../groups/definitions';
import { GICS_NAMES, type Gics } from './universe';
import {
  DEFAULT_WEIGHTS,
  type Confirmation,
  type DigestEntry,
  type RsRow,
  type Trend,
  type Weights,
} from './types';

/**
 * Turning returns into a ranking.
 *
 * Deliberately pure — no storage, no fetching, no `server-only`. Everything
 * here is a function of the digest entries plus the weights, which is what lets
 * the page re-rank instantly when someone moves a weight slider, and what lets
 * `scripts/verify-rs.js` check the maths without standing up the app.
 */

/**
 * Percentile ranks for one window, 0-100.
 *
 * Midranks: a value scores the share of the universe strictly below it, plus
 * half the share tied with it. The alternative — counting ties as "below" —
 * hands every member of a tie the top of the band, and with a few hundred
 * names carrying identical flat returns that inflates a whole cluster at once.
 *
 * Symbols with no return for this window are skipped rather than sorted to the
 * bottom. A stock that listed four months ago has no six-month performance; it
 * has not *underperformed* over six months, and ranking it as the weakest in
 * the index would be a statement the data does not support. It comes back as
 * `null` and the composite renormalises around it.
 */
export function percentileRanks(values: Array<number | null>): Array<number | null> {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const n = present.length;
  if (n === 0) return values.map(() => null);

  const sorted = [...present].sort((a, b) => a - b);

  /** Index of the first element not less than `x`. */
  const lower = (x: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  /** Index of the first element greater than `x`. */
  const upper = (x: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    const below = lower(v);
    const equal = upper(v) - below;
    return ((below + equal / 2) / n) * 100;
  });
}

/**
 * Blend three percentiles into one 0-100 score.
 *
 * Weights are renormalised over whichever windows are actually present, so a
 * name with only 1mo and 3mo history is scored on those two at their relative
 * proportions rather than being silently penalised for the missing third. The
 * page still shows how many windows fed each row, because a two-window score
 * is a weaker claim than a three-window one.
 */
export function composite(
  percentiles: { m1: number | null; m3: number | null; m6: number | null },
  weights: Weights,
): number | null {
  let sum = 0;
  let total = 0;

  for (const key of ['m1', 'm3', 'm6'] as const) {
    const pct = percentiles[key];
    const weight = weights[key];
    if (pct === null || !(weight > 0)) continue;
    sum += pct * weight;
    total += weight;
  }

  if (total <= 0) return null;
  return sum / total;
}

/**
 * Normalise user-supplied weights.
 *
 * They arrive from the URL, so they can be anything. Negatives are clamped to
 * zero — a negative weight would mean "reward underperformance", which is not
 * a thing this page should be able to express by mistyping. All-zero falls
 * back to the defaults rather than producing a page of nulls.
 */
export function normaliseWeights(raw: Partial<Weights>): Weights {
  const clean = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const m1 = clean(raw.m1);
  const m3 = clean(raw.m3);
  const m6 = clean(raw.m6);
  const total = m1 + m3 + m6;

  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return { m1: m1 / total, m3: m3 / total, m6: m6 / total };
}

/**
 * Below this the week-on-week move is not worth calling a direction.
 *
 * Two points on a 0-100 percentile scale is about ten places in a 500-name
 * index — inside the noise of one quiet week, and small enough that calling it
 * "strength building" would be overreading.
 */
export const TREND_EPSILON = 2;

function trendFrom(delta: number | null): Trend {
  if (delta === null || Math.abs(delta) < TREND_EPSILON) return 'FLAT';
  return delta > 0 ? 'RISING' : 'FALLING';
}

function membershipIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const group of GROUPS) {
    for (const symbol of group.symbols) {
      const existing = index.get(symbol);
      if (existing) existing.push(group.name);
      else index.set(symbol, [group.name]);
    }
  }
  return index;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export interface SignalLookup {
  get(symbol: string): { score: number; bullish: number; total: number } | undefined;
}

/**
 * Whether the recent move has volume behind it.
 *
 * Confirmed means the last month traded more heavily than the three months
 * before it — the move drew participation. Unconfirmed means it happened on
 * thinning volume, which is the classic shape of a drift that reverses.
 *
 * This is a statement about the *move*, not about the direction. A laggard
 * marked confirmed is falling on heavy volume, which makes the weakness more
 * credible rather than less — real selling, not neglect.
 *
 * Null when the history is too short to compare, which is deliberately not the
 * same as "unconfirmed": one says we cannot tell, the other is a finding.
 */
export function confirmationOf(volumeRatio: number | null): Confirmation | null {
  if (volumeRatio === null || !Number.isFinite(volumeRatio)) return null;
  return volumeRatio >= 1 ? 'confirmed' : 'unconfirmed';
}

export interface RankOptions {
  /** Symbol to GICS sector, for the sector filter. */
  sectors?: Map<string, Gics> | Record<string, Gics>;
  /** The nine-signal scores, where available. */
  signals?: SignalLookup | Record<string, { score: number; bullish: number; total: number }>;
  /**
   * Liquidity floor in dollars of average daily turnover.
   *
   * Applied *before* percentile ranking, which is the whole point of it: a
   * thin name that doubled is not competing for the top of the list, it is
   * excluded from the comparison entirely. Ranking it and then hiding it would
   * still let it push every liquid stock down a percentile.
   */
  minDollarVolume?: number;
}

function asGetter<T>(
  source: { get(symbol: string): T | undefined } | Record<string, T> | undefined,
): (symbol: string) => T | undefined {
  if (!source) return () => undefined;
  if (typeof (source as { get?: unknown }).get === 'function') {
    return (symbol) => (source as { get(s: string): T | undefined }).get(symbol);
  }
  return (symbol) => (source as Record<string, T>)[symbol];
}

/**
 * Rank the universe.
 *
 * Percentiles are always computed across every entry passed in — the whole
 * index — never across a filtered subset. That is what makes the score mean
 * "versus the other 499" no matter which group the reader is looking at; the
 * group filter narrows what is *displayed*, not what a name is measured
 * against. Filtering first would give a defensive utility a score of 95 for
 * being the best of eleven utilities in a sector going nowhere.
 */
export function rankUniverse(
  allEntries: DigestEntry[],
  weights: Weights,
  options: RankOptions = {},
): RsRow[] {
  const groups = membershipIndex();
  const sectorOf = asGetter(options.sectors);
  const signalOf = asGetter(options.signals);
  const floor = options.minDollarVolume ?? 0;

  /*
   * The liquidity floor is applied here, before anything is ranked, so that an
   * illiquid name never enters the comparison at all. A stock trading a
   * million dollars a day can post the best six-month return in the index on
   * volume nobody could have participated in; leaving it in the percentile
   * pool would displace every genuinely tradeable name below it.
   */
  const entries =
    floor > 0 ? allEntries.filter((e) => e.avgDollarVolume >= floor) : allEntries;

  const now = {
    m1: percentileRanks(entries.map((e) => e.returns.m1)),
    m3: percentileRanks(entries.map((e) => e.returns.m3)),
    m6: percentileRanks(entries.map((e) => e.returns.m6)),
  };

  /*
   * The prior week's percentiles are ranked against the prior week's universe,
   * not today's. Comparing a rank taken among 500 names against one taken among
   * 500 different numbers is the point — RS is a relative measure, so "my score
   * fell" has to be able to mean "everyone else rose".
   */
  const before = {
    m1: percentileRanks(entries.map((e) => e.prior.m1)),
    m3: percentileRanks(entries.map((e) => e.prior.m3)),
    m6: percentileRanks(entries.map((e) => e.prior.m6)),
  };

  const rows: RsRow[] = [];

  entries.forEach((entry, i) => {
    const percentiles = { m1: now.m1[i], m3: now.m3[i], m6: now.m6[i] };
    const score = composite(percentiles, weights);
    if (score === null) return;

    const prevPercentiles = { m1: before.m1[i], m3: before.m3[i], m6: before.m6[i] };
    const scorePrev = composite(prevPercentiles, weights);
    const delta = scorePrev === null ? null : score - scorePrev;

    const sector = sectorOf(entry.symbol) ?? null;

    rows.push({
      rank: 0, // assigned after the sort
      symbol: entry.symbol,
      sector,
      sectorName: sector ? GICS_NAMES[sector] : null,
      groups: groups.get(entry.symbol) ?? [],
      score: round1(score),
      scorePrev: scorePrev === null ? null : round1(scorePrev),
      delta: delta === null ? null : round1(delta),
      trend: trendFrom(delta),
      percentiles: {
        m1: percentiles.m1 === null ? null : round1(percentiles.m1),
        m3: percentiles.m3 === null ? null : round1(percentiles.m3),
        m6: percentiles.m6 === null ? null : round1(percentiles.m6),
      },
      returns: entry.returns,
      close: entry.close,
      changePct: entry.changePct,
      asOfDate: entry.asOfDate,
      windows: [percentiles.m1, percentiles.m3, percentiles.m6].filter((p) => p !== null)
        .length,
      avgDollarVolume: entry.avgDollarVolume,
      volumeRatio: entry.volumeRatio,
      confirmation: confirmationOf(entry.volumeRatio),
      // `?? null` rather than a bare read: digests written before the column
      // existed have no field at all, and `undefined` would cross to the
      // client as a missing key rather than an honest dash.
      rsi:
        entry.rsi14 === null || entry.rsi14 === undefined ? null : round1(entry.rsi14),
      signal: signalOf(entry.symbol) ?? null,
    });
  });

  return sortAndRank(rows, weights);
}

/**
 * Strongest first, with ranks assigned.
 *
 * Ties on the composite are broken by the heaviest window and then by symbol,
 * so the ordering is stable across renders rather than depending on the order
 * the shards happened to load in.
 */
function sortAndRank(rows: RsRow[], weights: Weights): RsRow[] {
  const key = weights.m3 >= weights.m6 ? 'm3' : 'm6';

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byWindow = (b.percentiles[key] ?? 0) - (a.percentiles[key] ?? 0);
    if (byWindow !== 0) return byWindow;
    return a.symbol.localeCompare(b.symbol);
  });

  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return rows;
}


/** `LEADERS` / `LAGGARDS` split, guarding against short universes overlapping. */
export function splitLeadersLaggards(
  rows: RsRow[],
  size = 10,
): { leaders: RsRow[]; laggards: RsRow[] } {
  const take = Math.min(size, Math.floor(rows.length / 2));
  return {
    leaders: rows.slice(0, take),
    laggards: rows.slice(rows.length - take).reverse(),
  };
}

const pct = (v: number | null, dp = 1): string =>
  v === null ? '' : (v * 100).toFixed(dp);

/** CSV of the ranking as displayed, for the export button. */
export function toCsv(rows: RsRow[]): string {
  const header =
    'rank,ticker,rs_score,rs_week_ago,rs_change,trend,pct_1mo,pct_3mo,pct_6mo,' +
    'ret_1mo_pct,ret_3mo_pct,ret_6mo_pct,close,change_pct,avg_dollar_volume,' +
    'volume_ratio,confirmation,rsi_14,signal_score,sector,groups,as_of';

  const rowsOut = rows.map((r) =>
    [
      r.rank,
      r.symbol,
      r.score,
      r.scorePrev ?? '',
      r.delta ?? '',
      r.trend,
      r.percentiles.m1 ?? '',
      r.percentiles.m3 ?? '',
      r.percentiles.m6 ?? '',
      pct(r.returns.m1),
      pct(r.returns.m3),
      pct(r.returns.m6),
      r.close.toFixed(2),
      pct(r.changePct, 2),
      Math.round(r.avgDollarVolume),
      r.volumeRatio === null ? '' : r.volumeRatio.toFixed(3),
      r.confirmation ?? '',
      r.rsi === null ? '' : r.rsi.toFixed(1),
      r.signal?.score ?? '',
      r.sectorName ? `"${r.sectorName}"` : '',
      `"${r.groups.join(' ')}"`,
      r.asOfDate,
    ].join(','),
  );

  return [header, ...rowsOut].join('\n');
}

/** Plain ticker list, newline separated, for the copy button. */
export function toPlainList(rows: RsRow[]): string {
  return rows.map((r) => r.symbol).join('\n');
}

// --- filter facets ------------------------------------------------------------

export interface Facet {
  id: string;
  label: string;
  kind: 'all' | 'group' | 'sector';
  /** Members, or null for "everything". Plain arrays so this can cross to the client. */
  symbols: string[] | null;
  count: number;
}

/**
 * The options in the group filter.
 *
 * Built from what is actually in the ranking rather than from the definitions
 * alone: a themed group whose members are all ETFs — INDEX, which is SPY, QQQ,
 * IWM and DIA — has no overlap with a list of index constituents, and offering
 * a filter that can only ever return nothing is worse than not offering it.
 *
 * Note that filtering never changes a score. Percentiles are computed against
 * the whole index up front, so narrowing to SEMI shows those names carrying
 * the ranks they earned against all five hundred.
 */
export function facetsFor(rows: RsRow[]): Facet[] {
  const present = new Set(rows.map((r) => r.symbol));

  const facets: Facet[] = [
    { id: 'all', label: 'All', kind: 'all', symbols: null, count: rows.length },
  ];

  for (const group of GROUPS) {
    const members = group.symbols.filter((s) => present.has(s));
    if (members.length === 0) continue;
    facets.push({
      id: group.id,
      label: group.name,
      kind: 'group',
      symbols: members,
      count: members.length,
    });
  }

  const bySector = new Map<Gics, string[]>();
  for (const row of rows) {
    if (!row.sector) continue;
    const existing = bySector.get(row.sector);
    if (existing) existing.push(row.symbol);
    else bySector.set(row.sector, [row.symbol]);
  }

  const sectors = [...bySector.entries()].sort((a, b) =>
    GICS_NAMES[a[0]].localeCompare(GICS_NAMES[b[0]]),
  );

  for (const [sector, symbols] of sectors) {
    facets.push({
      id: sector,
      label: GICS_NAMES[sector],
      kind: 'sector',
      symbols,
      count: symbols.length,
    });
  }

  return facets;
}
