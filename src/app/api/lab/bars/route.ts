import { NextResponse } from 'next/server';
import { isTimeframe } from '@/lib/bars/types';
import { labAvailable, labSessionValid } from '@/lib/lab/access';
import { getLiveBars, LiveCandlesUnavailable } from '@/lib/tasty/candles';
import { normaliseSymbol } from '@/lib/ticker/bars';

/**
 * Live chart candles for `/lab`: `GET /api/lab/bars?symbol=SPY&tf=5m`.
 *
 * Same response shape as the public `/api/bars`, built from dxFeed `Candle`
 * events instead of the 15-minute-delayed bar feed. Behind the `/lab` lock —
 * 404 when the lab is off, 401 without a session — because the Tastytrade
 * feed is licensed for `/lab` only and must never back a public page.
 *
 * 503 when the feed cannot supply candles (mock mode, socket down, nothing in
 * time). The chart then falls back to the delayed bars and says so loudly;
 * this route itself never serves delayed data.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  if (!labAvailable()) return new NextResponse('Not found', { status: 404 });
  if (!(await labSessionValid())) return new NextResponse('Unauthorized', { status: 401 });

  const params = new URL(request.url).searchParams;
  const symbol = normaliseSymbol(params.get('symbol') ?? '');
  if (!symbol) return NextResponse.json({ error: 'Invalid or missing symbol.' }, { status: 400 });
  const tf = params.get('tf');
  if (!isTimeframe(tf)) return NextResponse.json({ error: 'Unknown timeframe.' }, { status: 400 });

  try {
    const series = await getLiveBars(symbol, tf);
    return NextResponse.json(series, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: error instanceof LiveCandlesUnavailable ? message : 'Could not read candles from dxLink.', detail: message },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
