import 'server-only';

import { cached } from './cache';
import { config } from './config';
import { formatAsOf } from './time';

/**
 * US net liquidity — how much money is sloshing around the financial system.
 *
 *     net liquidity = WALCL − WTREGEN − RRPONTSYD
 *                     (Fed balance sheet, Treasury General Account, reverse repo)
 *
 * REGIME CONTEXT ONLY. Nothing in this module may reach the nine-signal
 * consensus, the decision verdict, the forecast drift, or any per-ticker
 * score. This measure moves over weeks and months; every decision the rest of
 * the site describes is days-to-weeks, and wiring a slow series into a fast
 * one manufactures agreement that is really just the slow series leaking in.
 * It is imported by the dashboard tile and nothing else — keep it that way.
 *
 * Unrelated to the tradeability panel on the decision page, which rates one
 * stock. The two share the English word "liquidity" and nothing else, which
 * is why neither screen uses that word unqualified.
 *
 * ---
 *
 * WEEKLY, NOT DAILY. WALCL and WTREGEN are weekly Wednesday prints; only
 * RRPONTSYD is daily. Pairing a fresh RRP against two week-old series would
 * produce a number that moves every day, and every one of those moves would
 * be an artefact of the newest series rather than a change in liquidity. So
 * the series is computed once per Wednesday, with RRP read as of that same
 * Wednesday, and forward-filled in between.
 */

const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

/**
 * Units differ across the three series and FRED does not normalise them.
 *
 * WALCL and WTREGEN are published in millions of dollars; RRPONTSYD is in
 * billions. Subtracting them raw understates the repo drain by a factor of a
 * thousand and yields a plausible-looking, wrong number — which is worse than
 * an obviously broken one.
 */
const MILLIONS = 1e6;
const BILLIONS = 1e9;

export type NetLiquidityDirection = 'rising' | 'falling' | 'flat';

export interface NetLiquidityWeek {
  /** Wednesday the weekly series printed, `YYYY-MM-DD`. */
  weekOf: string;
  /** Net liquidity in dollars. */
  net: number;
  walcl: number;
  tga: number;
  rrp: number;
  /** Change against the previous week, in dollars. Null for the first week. */
  changeUsd: number | null;
  changePct: number | null;
  /**
   * Null on the first week, where there is nothing to compare against.
   * `flat` whenever the move does not clear the configured threshold.
   */
  direction: NetLiquidityDirection | null;
}

export interface NetLiquidityResult {
  latest: NetLiquidityWeek;
  /** Oldest first. */
  history: NetLiquidityWeek[];
  /** Percent a weekly move must clear before it is called rising or falling. */
  flatThresholdPct: number;
  fetchedAtLabel: string;
}

export class NetLiquidityError extends Error {}

export interface Observation {
  date: string;
  value: number;
}

/**
 * One FRED series as `{date, value}`, oldest first.
 *
 * Each series is fetched on its own. Asking `fredgraph.csv` for several ids at
 * mixed frequencies makes it return a ZIP of per-frequency CSVs rather than
 * one table, which is not something to parse when three plain requests do.
 */
async function fetchSeries(id: string): Promise<Observation[]> {
  const res = await fetch(`${FRED_CSV}?id=${encodeURIComponent(id)}`, {
    headers: { Accept: 'text/csv' },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: config.netLiquidity.cacheSeconds },
  });
  if (!res.ok) {
    throw new NetLiquidityError(`FRED returned ${res.status} for ${id}.`);
  }

  const body = await res.text();
  const out: Observation[] = [];

  // Header row, then `YYYY-MM-DD,value`. A missing print is a literal ".".
  for (const line of body.split('\n').slice(1)) {
    const [date, raw] = line.trim().split(',');
    if (!date || !raw || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }

  if (out.length === 0) {
    throw new NetLiquidityError(`FRED returned no usable rows for ${id}.`);
  }
  return out;
}

/** Most recent observation on or before `date` — the forward fill. */
function asOf(series: Observation[], date: string): Observation | null {
  let found: Observation | null = null;
  for (const o of series) {
    if (o.date > date) break;
    found = o;
  }
  return found;
}

function directionOf(changePct: number, thresholdPct: number): NetLiquidityDirection {
  if (Math.abs(changePct) < thresholdPct) return 'flat';
  return changePct > 0 ? 'rising' : 'falling';
}

/**
 * The weekly series, given three raw FRED series.
 *
 * Pure and exported so `scripts/verify-netliq.js` can exercise it against
 * known rows — the unit mismatch between the three series is exactly the kind
 * of bug that produces a confident, plausible, wrong number, so it is worth
 * being able to assert on directly.
 *
 * `walcl` and `tga` arrive in millions of dollars, `rrp` in billions.
 */
export function computeWeeks(
  walcl: Observation[],
  tga: Observation[],
  rrp: Observation[],
  thresholdPct: number,
  historyWeeks: number,
): NetLiquidityWeek[] {
  /*
   * WALCL's Wednesdays drive the calendar. A week is only computed when all
   * three series have a print on or before it, so the newest Wednesday is
   * skipped entirely rather than half-filled if the TGA has not posted yet.
   */
  const weeks: NetLiquidityWeek[] = [];
  const wanted = historyWeeks + 1;

  for (const balance of walcl.slice(-wanted)) {
    const tgaAt = asOf(tga, balance.date);
    const rrpAt = asOf(rrp, balance.date);
    if (!tgaAt || !rrpAt) continue;

    const net =
      balance.value * MILLIONS - tgaAt.value * MILLIONS - rrpAt.value * BILLIONS;

    weeks.push({
      weekOf: balance.date,
      net,
      walcl: balance.value * MILLIONS,
      tga: tgaAt.value * MILLIONS,
      rrp: rrpAt.value * BILLIONS,
      changeUsd: null,
      changePct: null,
      direction: null,
    });
  }

  for (let i = 1; i < weeks.length; i += 1) {
    const previous = weeks[i - 1];
    const week = weeks[i];
    const changeUsd = week.net - previous.net;
    week.changeUsd = changeUsd;
    week.changePct = previous.net !== 0 ? (changeUsd / Math.abs(previous.net)) * 100 : null;
    week.direction =
      week.changePct === null ? null : directionOf(week.changePct, thresholdPct);
  }

  // The extra leading week existed only to give the second one a comparison.
  return weeks.slice(-historyWeeks);
}

async function build(): Promise<NetLiquidityResult> {
  const [walcl, tga, rrp] = await Promise.all([
    fetchSeries('WALCL'),
    fetchSeries('WTREGEN'),
    fetchSeries('RRPONTSYD'),
  ]);

  const threshold = config.netLiquidity.flatThresholdPct;
  const history = computeWeeks(
    walcl,
    tga,
    rrp,
    threshold,
    config.netLiquidity.historyWeeks,
  );

  if (history.length === 0) {
    throw new NetLiquidityError(
      'No week had all three series available, so net liquidity could not be computed.',
    );
  }

  return {
    latest: history[history.length - 1],
    history,
    flatThresholdPct: threshold,
    fetchedAtLabel: formatAsOf(new Date()),
  };
}

/**
 * Cached net liquidity, or a throw.
 *
 * Never returns a placeholder or a synthesised series. A caller that cannot
 * get this must render an explicit unavailable state — a fabricated macro
 * figure is indistinguishable from a real one on screen.
 */
export function getNetLiquidity(): Promise<NetLiquidityResult> {
  return cached('net-liquidity', config.netLiquidity.cacheSeconds, build);
}
