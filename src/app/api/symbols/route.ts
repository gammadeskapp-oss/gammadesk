import { NextResponse } from 'next/server';
import { getSymbolDirectory } from '@/lib/symbols/directory';
import { searchSymbols } from '@/lib/symbols/search';

/**
 * Autocomplete for the ticker boxes: `GET /api/symbols?q=app`.
 *
 * Matching runs here rather than in the browser on purpose. The full directory
 * is around 300KB of JSON, and shipping that to a phone so it can filter
 * locally is a poor trade against a handful of tiny responses — especially for
 * the beginners this feature is for, who are the least likely to be on a fast
 * connection.
 */

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 12;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').trim();

  const requested = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : 8;

  if (!q) return NextResponse.json({ results: [] });

  try {
    const directory = await getSymbolDirectory();
    const results = searchSymbols(directory.entries, q, limit);

    return NextResponse.json(
      { results },
      {
        headers: {
          // Listings barely change, and a user retyping the same prefix should
          // not touch the network at all.
          'cache-control': 'public, max-age=600, s-maxage=3600',
        },
      },
    );
  } catch {
    // An empty list degrades to a plain text box, which still works.
    return NextResponse.json({ results: [] }, { status: 200 });
  }
}
