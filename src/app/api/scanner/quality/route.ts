import { NextResponse } from 'next/server';
import { normaliseSymbol } from '@/lib/positioning';
import { readTodaysScan } from '@/lib/scanner';
import { gradeSymbol } from '@/lib/scanner/optionChain';
import type { EarningsInfo } from '@/lib/scanner/types';

export const dynamic = 'force-dynamic';

/**
 * Grade one name's option chain on demand.
 *
 * ## Why this endpoint exists
 *
 * The scan grades the top ten ranked names at 09:35 and stops, because Cboe
 * answers a limited number of chains per window and the 08:30 gamma refresh
 * has already spent most of it. Everything below the tenth is graded here,
 * when a reader actually opens it — which is the only point at which spending
 * a request on it buys anything.
 *
 * ## The earnings date is read from the stored scan, never re-fetched
 *
 * The badge depends on it: a contract inside ten days of a report grades
 * `Avoid`, and an unknown date caps the badge at `Caution`. Re-looking it up
 * here would let one name's badge rest on a different reading from the watch
 * line beside it, which is exactly the kind of quiet disagreement the scan
 * stores its inputs to prevent. If the symbol is not in today's scan, the
 * earnings state is `unknown` and the grade is capped accordingly.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = (params.get('symbol') ?? '').trim().toUpperCase();

  const symbol = requested ? normaliseSymbol(requested) : null;
  if (!symbol) {
    return NextResponse.json(
      { error: `${requested || 'A symbol'} is not a ticker symbol.` },
      { status: 400 },
    );
  }

  /*
   * Only names in today's scan may be graded. Without this the endpoint is an
   * open proxy onto the chain provider: anyone could walk it symbol by symbol
   * and burn the window the morning job depends on.
   */
  const scan = await readTodaysScan();
  const row = scan?.rows.find((r) => r.symbol === symbol);

  if (!row) {
    return NextResponse.json(
      {
        error: `${symbol} is not in today's scan, so its contract was not checked.`,
        hint: 'Only names the morning scan evaluated can be graded here.',
      },
      { status: 404 },
    );
  }

  const earnings: EarningsInfo = row.earnings;
  const quality = await gradeSymbol(symbol, earnings, 'on-click');

  return NextResponse.json({ symbol, quality });
}
