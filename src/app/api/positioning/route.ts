import { NextResponse } from 'next/server';
import { ChainError } from '@/lib/chainSource';
import { config } from '@/lib/config';
import { getPositioning, secondsUntilRefresh } from '@/lib/positioning';

export const dynamic = 'force-dynamic';

/**
 * Read-only JSON view of the same snapshot the dashboard renders.
 *
 * By default this only ever serves the cached snapshot, so hitting it in a loop
 * cannot burn the Polygon free-plan quota. A forced refresh is possible but
 * requires `GAMMADESK_REFRESH_TOKEN` to be set and supplied, precisely because
 * an unauthenticated force-refresh endpoint is a free way for anyone to
 * exhaust the account's 5 requests per minute.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const secret = process.env.GAMMADESK_REFRESH_TOKEN?.trim();

  const wantsForce = url.searchParams.get('refresh') === '1';
  const mayForce = Boolean(secret) && token === secret;

  if (wantsForce && !mayForce) {
    return NextResponse.json(
      {
        error: 'Forced refresh requires a valid token.',
        detail:
          'Set GAMMADESK_REFRESH_TOKEN in the environment and pass it as ?token=. Without it, this endpoint serves the cached snapshot only.',
      },
      { status: 403 },
    );
  }

  try {
    const data = await getPositioning({ force: wantsForce && mayForce });

    return NextResponse.json(
      { ...data, cache: { secondsUntilRefresh: secondsUntilRefresh() } },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${config.cacheSeconds}, stale-while-revalidate=600`,
        },
      },
    );
  } catch (error) {
    if (error instanceof ChainError) {
      return NextResponse.json(
        { error: error.message, detail: error.hint },
        { status: error.status >= 400 ? error.status : 502 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to build positioning data.' },
      { status: 500 },
    );
  }
}
