import 'server-only';

import { yahooSymbol } from './universe';

/**
 * Daily closes for the RS universe.
 *
 * ## Why this does not call `ticker/bars.ts`
 *
 * That module is the right tool for one symbol on the /ticker page: it prefers
 * Polygon, which is split- and dividend-adjusted and supported. It is the
 * wrong tool for five hundred. Polygon's stocks quota is five requests a
 * minute even on the paid options plan, so its fallback path would turn a
 * 125-symbol shard into a wall of 429s, and its responses are cached with a
 * `revalidate` window tuned for interactive page views rather than a nightly
 * job. This is Yahoo only, uncached, and returns closes rather than full bars
 * because closes are all a percentile ranking can use.
 *
 * Stooq was considered and rejected for the same reason `ticker/bars.ts`
 * rejected it: it answers with a JavaScript bot challenge instead of CSV.
 *
 * ## Splits
 *
 * Yahoo's chart endpoint does **not** retroactively adjust for a recent split
 * — neither `close` nor `adjclose`. Measured on MNST, which split 2-for-1 on
 * 2026-08-11: a plain two-year request returned 90.36 for 2026-08-07 and 45.53
 * for 2026-08-11, a 50% cliff sitting in the middle of one response, with
 * `adjclose` identical to `close` throughout. Left alone that hands the stock
 * a -52% one-month return and drops it to last place in the index, which is
 * exactly what it did before this was fixed.
 *
 * So the request asks for `events=split` and the ratios are applied here:
 * every close *before* a split is divided by it, which is what "adjusted"
 * means. This is the authoritative fix — the ratios come from the source
 * rather than being inferred from the shape of the series.
 *
 * `refresh.ts` keeps its own split check as a second line of defence, for a
 * split the events feed reports late or not at all. That one compares a fresh
 * fetch against stored history, so it can only catch a split that lands
 * between two runs; this one catches a split sitting inside a single response,
 * which is the case a backfill hits.
 *
 * ## Dividends
 *
 * Not adjusted for, deliberately. Dividend adjustment would make a high-yield
 * utility's six-month "performance" include its payouts while a non-payer's
 * does not — a defensible total-return view, but not what a momentum screen
 * means by relative strength.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export interface DailyBar {
  /** `YYYY-MM-DD`, New York session date. */
  date: string;
  /** Split-adjusted close. */
  close: number;
  /** Shares traded. Zero when the upstream did not report it. */
  volume: number;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }>;
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

/** Yahoo accepts only a fixed set of range tokens, so snap to the nearest. */
function rangeToken(years: number): string {
  if (years <= 1) return '1y';
  if (years <= 2) return '2y';
  if (years <= 5) return '5y';
  if (years <= 10) return '10y';
  return 'max';
}

/**
 * Yahoo stamps each daily bar at the session open in exchange time, so the
 * epoch second lands at 13:30 or 14:30 UTC depending on daylight saving.
 * Slicing the UTC ISO string is therefore safe for US equities — the instant
 * never crosses midnight UTC — and avoids a timezone conversion per bar across
 * a million bars.
 */
function sessionDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Daily closes, oldest first.
 *
 * Returns null when the symbol genuinely has no history — a delisting, or a
 * ticker the upstream does not know. *Throws* when the request itself failed.
 * The distinction matters: a delisted name should quietly leave the ranking,
 * whereas five hundred rows reading "no history" because the network was down
 * is an outage that has to be visible in the refresh notes rather than
 * indistinguishable from a very bad day for the index.
 */
export async function fetchBars(
  symbol: string,
  years: number,
): Promise<DailyBar[] | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol(symbol)}` +
    `?range=${rangeToken(years)}&interval=1d&events=split`;

  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    cache: 'no-store',
  });

  // 404 is Yahoo's answer for a symbol it has no chart for, which is a fact
  // about the symbol. Every other bad status is a fact about the request.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as YahooChartResponse;
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close;
  if (!stamps || !closes) return null;

  const out: DailyBar[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = closes[i];
    // Yahoo pads holidays and halts with nulls. Those rows are dropped rather
    // than carried forward: a flat close invented for a halted session would
    // become a real 0% day inside a momentum window.
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue;
    const volume = quote?.volume?.[i];
    out.push({
      date: sessionDate(stamps[i]),
      close,
      volume: typeof volume === 'number' && Number.isFinite(volume) && volume > 0
        ? volume
        : 0,
    });
  }

  if (out.length === 0) return null;
  return applySplits(out, result?.events?.splits);
}

/**
 * Divide every bar before a split by its ratio — but only where the upstream
 * has not already done it.
 *
 * ## Why the check is necessary
 *
 * Yahoo adjusts its price history for splits *eventually*, not immediately. An
 * old split is already folded into the series it serves; a recent one is not.
 * Applying every split in the events feed unconditionally therefore fixes the
 * recent ones and breaks the old ones — measured on a two-year window, that
 * turned DECK's already-adjusted 6-for-1 into a fake 26 -> 155 gap and LRCX's
 * 10-for-1 into 8 -> 81, inventing enormous returns out of nothing.
 *
 * So each split is tested against the data rather than trusted: compare the
 * last close before it with the first close on or after it. If they differ by
 * roughly the split ratio, the series is raw and the split needs applying. If
 * they are continuous, the upstream has already handled it and touching it
 * would create the very cliff this function exists to remove.
 *
 * The 15% tolerance is set from the three cases it has to separate. For a
 * 2-for-1: an unadjusted series shows a ratio of ~2.00 (deviation ~0), an
 * already-adjusted one shows ~1.00 (deviation 0.50), and a bad-but-real day
 * like a 37% earnings drop shows ~1.59 (deviation 0.21). Fifteen percent
 * admits the first and rejects the other two, while still leaving room for a
 * stock that genuinely moves several percent on its split day — which is
 * ordinary, since a split is not news.
 *
 * Prices are divided and volumes multiplied, so that price times volume — the
 * dollar volume the liquidity filter is built on — comes out unchanged across
 * the split. Adjusting price alone would halve a stock's apparent liquidity
 * overnight and could drop it below the floor for no reason.
 *
 * Ratios are accumulated from the most recent applicable split backwards, so
 * two unadjusted splits inside one window compound correctly rather than only
 * the nearer one applying.
 */
type SplitEvents = Record<
  string,
  { date?: number; numerator?: number; denominator?: number }
>;

function applySplits(bars: DailyBar[], splits: SplitEvents | undefined): DailyBar[] {
  if (!splits) return bars;

  const declared = Object.values(splits)
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
    .filter((s): s is { date: string; ratio: number } => s.date !== null && s.ratio !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Keep only the splits the series has not already been adjusted for.
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
    // A split at the very edge of the window has nothing to compare against;
    // leaving it alone is the safe choice, since a wrong adjustment invents a
    // cliff whereas a missed one is caught by the merge-time check.
    if (before === null || after === null || after <= 0) return false;

    const observed = before / after;
    return Math.abs(observed / ratio - 1) < 0.15;
  });

  if (events.length === 0) return bars;

  /*
   * Suffix products: `pending[i]` is the combined ratio of every split from
   * `events[i]` onwards. A bar is divided by the product of all splits dated
   * strictly after it.
   */
  const pending = new Array<number>(events.length + 1).fill(1);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    pending[i] = pending[i + 1] * events[i].ratio;
  }

  let next = 0;
  return bars.map((bar) => {
    while (next < events.length && events[next].date <= bar.date) next += 1;
    const factor = pending[next];
    if (factor === 1) return bar;
    return { date: bar.date, close: bar.close / factor, volume: bar.volume * factor };
  });
}
