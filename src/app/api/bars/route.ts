import { NextResponse } from 'next/server';
import { getBars, isTimeframe } from '@/lib/bars/intraday';
import { normaliseSymbol } from '@/lib/ticker/bars';

/**
 * Bars for the interactive chart: `GET /api/bars?symbol=SPY&tf=5m`.
 *
 * The chart switches timeframe without a page navigation, so this exists to
 * answer that one question quickly. Indicators are not computed here — the
 * browser derives EMAs, VWAP and RSI from these bars, so toggling an overlay
 * costs nothing and never refetches.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const symbol = normaliseSymbol(params.get('symbol') ?? '');
  if (!symbol) {
    return NextResponse.json({ error: 'Invalid or missing symbol.' }, { status: 400 });
  }

  const tf = params.get('tf');
  if (!isTimeframe(tf)) {
    return NextResponse.json({ error: 'Unknown timeframe.' }, { status: 400 });
  }

  try {
    const series = await getBars(symbol, tf);
    return NextResponse.json(series, {
      headers: {
        // Matches the server cache. Quotes are delayed anyway, so a short
        // browser cache costs the viewer nothing they could have seen.
        'cache-control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Could not load bars.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
