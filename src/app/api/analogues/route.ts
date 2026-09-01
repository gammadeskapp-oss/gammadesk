import { NextResponse } from 'next/server';
import { getAnalogues } from '@/lib/analogues';
import { TickerError } from '@/lib/ticker/bars';

/**
 * The analogue view for one symbol, as JSON.
 *
 * Read-only and computed on demand: nothing here writes to a store, and no
 * cron calls it. It exists so the numbers on the page can be checked against
 * their source without scraping the HTML.
 */

export const dynamic = 'force-dynamic';

/**
 * Thirty years of bars and sixteen detectors, on a cold cache. Well inside
 * this, but the default 10s is not obviously enough for the slowest symbol.
 */
export const maxDuration = 30;

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol')?.trim();

  if (!symbol) {
    return NextResponse.json(
      { error: 'Pass ?symbol= a US ticker.' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await getAnalogues(symbol));
  } catch (error) {
    if (error instanceof TickerError) {
      return NextResponse.json(
        { error: error.message, hint: error.hint },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: 'Could not build the analogue view.' },
      { status: 500 },
    );
  }
}
