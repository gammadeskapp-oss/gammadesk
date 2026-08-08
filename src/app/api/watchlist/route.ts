import { NextResponse } from 'next/server';
import { scoreSymbols } from '@/lib/ticker/quickScore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Hard ceiling regardless of what the client asks for. */
const MAX_SYMBOLS = 30;

/**
 * Scores for a caller-supplied list of symbols.
 *
 * The watchlist lives in the browser, so the server has no idea what is on it
 * until asked. Every symbol is validated against the same allow-list used
 * everywhere else, the list is capped, and each result is cached per symbol —
 * so a page refresh costs nothing and a hostile caller cannot turn this into
 * an unbounded fan-out.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('symbols') ?? '';

  const requested = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (requested.length === 0) {
    return NextResponse.json({ results: [], truncated: false });
  }

  try {
    const results = await scoreSymbols(requested);
    return NextResponse.json({
      results,
      truncated: raw.split(',').filter(Boolean).length > MAX_SYMBOLS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Could not score those symbols.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
