import 'server-only';

import type { EpisodicBar } from './types';

/**
 * Split-adjusted daily OHLCV bars for the episodic scan, from Yahoo.
 *
 * ## Why not reuse the other two bar fetchers
 *
 * `rs/history.ts` is Yahoo-only and fans out over the index the way this needs
 * to, but it returns closes and volumes alone — the gap test needs the open,
 * the high and the low. `ticker/bars.ts` returns full OHLC but prefers Polygon
 * (five requests a minute, hopeless across thousands of names) and its Yahoo
 * path does not adjust for splits at all. This module is the intersection the
 * scan actually needs: Yahoo only, full OHLC, and split-adjusted.
 *
 * ## Splits matter *more* here than anywhere else on the site
 *
 * The universe is small- and mid-caps above $5, which is exactly where reverse
 * splits happen — and a reverse split is a fake gap *up*. A 1-for-10 reverse
 * split turns a $2 close into a $20 open, a +900% "gap" that would top this
 * ranking every time if left raw. So the request asks for `events=split` and
 * the ratios are applied here, using the same measured, tested logic as
 * `rs/history.ts`: a split is adjusted only where the series has not already
 * been adjusted for it upstream, decided by comparing the closes across the
 * split rather than trusting the event blindly. Prices are divided and volumes
 * multiplied, so dollar volume stays continuous.
 *
 * Not dividend-adjusted, deliberately — same as the rest of the site. A gap is
 * a price event, and dividend adjustment would smear a small drift across every
 * bar for no benefit to this pattern.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Yahoo writes class shares with a dash (`BRK-B`); we store the dot form. */
function yahooSymbol(symbol: string): string {
  return symbol.replace('.', '-');
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { dataGranularity?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
      events?: {
        splits?: Record<
          string,
          { date?: number; numerator?: number; denominator?: number }
        >;
      };
    }>;
  };
}

/**
 * Yahoo stamps each daily bar at the session open in exchange time, so the
 * epoch second lands mid-day UTC and slicing the ISO string is safe for US
 * equities — the instant never crosses midnight UTC.
 */
function sessionDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * A year of daily OHLCV bars, oldest first, split-adjusted.
 *
 * Returns null when the symbol genuinely has no history — a delisting, or a
 * ticker the upstream does not know (Yahoo's 404). *Throws* when the request
 * itself failed, so `refresh.ts` can tell a delisted name (a fact about the
 * symbol) from an outage (a fact about the run) and report the difference.
 *
 * One year is enough: the scan needs a 60-session base, a 20-session gap
 * window and a 50-session volume average, comfortably inside 250 sessions,
 * while a shorter request would leave recently listed names unevaluable.
 */
/**
 * One fetch, with a single retry for a *transient* failure.
 *
 * The full-universe run measured zero rate-limiting at concurrency 24, so this
 * is insurance rather than a fix for a problem we have — but a scan that runs
 * on a busier day, or against a slower Yahoo, should not throw away a name over
 * one 429 or one dropped connection. So a 429, a 5xx or a network/timeout error
 * is retried once after a short backoff (honouring `Retry-After` when Yahoo
 * sends it); a 404 and every other 4xx pass straight through, because a retry
 * cannot turn an unknown ticker into a known one and would only slow the run.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  const attempt = () =>
    fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      cache: 'no-store',
      // A hung request must fail cleanly rather than hold a worker for the whole
      // run; the pool has its own deadline above this as a backstop.
      signal: AbortSignal.timeout(12_000),
    });

  let res: Response;
  try {
    res = await attempt();
    if (res.status !== 429 && res.status < 500) return res;
  } catch {
    // Network error or the 12s abort — fall through to the single retry.
    res = undefined as unknown as Response;
  }

  const retryAfter = res ? Number(res.headers.get('retry-after')) : NaN;
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 5_000)
    : 500 + Math.floor(Math.random() * 500);
  await new Promise((r) => setTimeout(r, waitMs));

  // Second and last attempt: let its result (or its throw) stand.
  return attempt();
}

/** A declared or applied split, in the plain shape the diagnostics carry. */
export interface SplitEvent {
  date: string;
  /** numerator / denominator — below 1 is a reverse split. */
  ratio: number;
}

/**
 * Bars plus the split provenance behind them, for auditing.
 *
 * `declared` is every split Yahoo reported in the window; `applied` is the
 * subset this code actually corrected for (the ones the series had not already
 * been adjusted for upstream). The reverse-split audit and the `?probe=` route
 * read these to prove a reverse split was neutralised rather than left to read
 * as a fake gap.
 */
export interface DetailedBars {
  bars: EpisodicBar[];
  declared: SplitEvent[];
  applied: SplitEvent[];
}

/** Bars only — the hot path the scan uses. */
export async function fetchDailyBars(symbol: string): Promise<EpisodicBar[] | null> {
  const detailed = await fetchDailyBarsDetailed(symbol);
  return detailed ? detailed.bars : null;
}

/** Bars plus split provenance, for the reverse-split audit and the probe route. */
export async function fetchDailyBarsDetailed(symbol: string): Promise<DetailedBars | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol(symbol)}` +
    `?range=1y&interval=1d&events=split`;

  const res = await fetchWithRetry(url);

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as YahooChartResponse;
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!stamps || !quote) return null;

  // A downgrade to non-daily granularity must stop the name, not relabel
  // monthly bars as sessions — the same guard `analogues/deepBars.ts` carries.
  const granularity = result?.meta?.dataGranularity;
  if (granularity && granularity !== '1d') {
    throw new Error(`upstream returned ${granularity} bars, not daily`);
  }

  const out: EpisodicBar[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    // Yahoo pads holidays and halts with nulls. Drop those rows rather than
    // carrying a close forward — an invented flat day would read as a real one.
    if (
      typeof o !== 'number' || !Number.isFinite(o) || o <= 0 ||
      typeof h !== 'number' || !Number.isFinite(h) || h <= 0 ||
      typeof l !== 'number' || !Number.isFinite(l) || l <= 0 ||
      typeof c !== 'number' || !Number.isFinite(c) || c <= 0
    ) {
      continue;
    }
    const v = quote.volume?.[i];
    out.push({
      date: sessionDate(stamps[i]),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0,
    });
  }

  if (out.length === 0) return null;
  return applySplits(out, result?.events?.splits);
}

type SplitEvents = Record<
  string,
  { date?: number; numerator?: number; denominator?: number }
>;

/**
 * Divide every OHLC before a split by its ratio, multiply the volume — but only
 * for splits the series has not already been adjusted for upstream.
 *
 * The check and the 15% tolerance are lifted directly from `rs/history.ts`,
 * where they were measured against the three cases they have to separate: an
 * unadjusted split (observed ratio ~= the declared ratio), an already-adjusted
 * one (~1), and a big-but-real earnings day (somewhere between). The only
 * change here is that all four prices are scaled, not just the close.
 */
function applySplits(bars: EpisodicBar[], splits: SplitEvents | undefined): DetailedBars {
  if (!splits) return { bars, declared: [], applied: [] };

  const declared: SplitEvent[] = Object.values(splits)
    .map((s) => ({
      date: typeof s.date === 'number' ? sessionDate(s.date) : null,
      ratio:
        typeof s.numerator === 'number' &&
        typeof s.denominator === 'number' &&
        s.denominator > 0 &&
        s.numerator > 0
          ? s.numerator / s.denominator
          : null,
    }))
    .filter((s): s is SplitEvent => s.date !== null && s.ratio !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const events = declared.filter(({ date, ratio }) => {
    let before: number | null = null;
    let after: number | null = null;
    for (const bar of bars) {
      if (bar.date < date) before = bar.close;
      else {
        after = bar.close;
        break;
      }
    }
    if (before === null || after === null || after <= 0) return false;
    const observed = before / after;
    return Math.abs(observed / ratio - 1) < 0.15;
  });

  if (events.length === 0) return { bars, declared, applied: [] };

  // Suffix products: a bar is divided by the combined ratio of every split
  // dated strictly after it.
  const pending = new Array<number>(events.length + 1).fill(1);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    pending[i] = pending[i + 1] * events[i].ratio;
  }

  let next = 0;
  const adjusted = bars.map((bar) => {
    while (next < events.length && events[next].date <= bar.date) next += 1;
    const factor = pending[next];
    if (factor === 1) return bar;
    return {
      date: bar.date,
      open: bar.open / factor,
      high: bar.high / factor,
      low: bar.low / factor,
      close: bar.close / factor,
      volume: bar.volume * factor,
    };
  });

  return { bars: adjusted, declared, applied: events };
}
