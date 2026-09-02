import 'server-only';

import type { VixByDate } from './regimes';

/**
 * VIX closes by session date.
 *
 * Same Yahoo chart endpoint the bars already come from, asked for `^VIX` and
 * by period so it is not downgraded to monthly — see `deepBars.ts` for that
 * trap. It reaches back to 1990, which is earlier than SPY, so the VIX filter
 * covers the whole of every symbol's history rather than a recent slice.
 *
 * Failure is not fatal. A missing VIX series turns one filter off and leaves
 * the rest of the page working, which is why the caller treats null as "that
 * filter is unavailable" rather than as an error.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { dataGranularity?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
}

export async function fetchVix(): Promise<VixByDate | null> {
  const now = Math.floor(Date.now() / 1000);
  const res = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX' +
      `?period1=0&period2=${now}&interval=1d`,
    {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      next: { revalidate: 3600 },
    },
  ).catch(() => null);

  if (!res || !res.ok) return null;

  const body = (await res.json().catch(() => null)) as YahooChartResponse | null;
  const result = body?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!stamps || !closes) return null;

  // Monthly bars would put a whole month's VIX against one session and bucket
  // the other nineteen days wrong, so they are refused rather than used.
  if (result.meta?.dataGranularity && result.meta.dataGranularity !== '1d') {
    return null;
  }

  const out: VixByDate = new Map();
  for (let i = 0; i < stamps.length; i += 1) {
    const close = closes[i];
    if (typeof close !== 'number') continue;
    out.set(new Date(stamps[i] * 1000).toISOString().slice(0, 10), close);
  }

  return out.size > 0 ? out : null;
}
