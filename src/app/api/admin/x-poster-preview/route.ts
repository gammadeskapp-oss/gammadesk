import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { marketToday } from '@/lib/time';
import { readPosterData } from '@/lib/x/poster/store';
import { renderPoster } from '@/lib/x/poster/render';
import { samplePoster } from '@/lib/x/poster/sample';
import type { PosterKind } from '@/lib/x/poster/types';

/**
 * Owner-only render of the X poster, so /admin/x-posts can preview it beside the
 * Discord version before enabling. Renders the stored Cowork payload for a date,
 * or a built-in sample for checking the design when no real data has flowed yet.
 *
 * `?type=morning|closing`, `?variant=full|x` (default x), `?date=YYYY-MM-DD`
 * (defaults to today), `?sample=1` to use the sample payload. The `X-Poster-Cut`
 * response header lists any sections dropped to fit the X size cap.
 *
 * The sample path is open in development so the design can be iterated without a
 * session; everything else needs the same signed admin cookie as the console.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  if (type !== 'morning' && type !== 'closing') {
    return NextResponse.json({ error: 'type must be morning or closing.' }, { status: 400, headers: NO_STORE });
  }
  const kind = type as PosterKind;
  const variant = params.get('variant') === 'full' ? 'full' : 'x';
  const sample = params.get('sample') === '1';

  const devSample = sample && process.env.NODE_ENV !== 'production';
  if (!devSample) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!verifySession(token)) {
      return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
    }
  }

  const dateParam = params.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : marketToday();

  const data = sample ? samplePoster(kind) : await readPosterData(date, kind).catch(() => null);
  if (!data) {
    return NextResponse.json({ error: 'No poster data for that date.' }, { status: 404, headers: NO_STORE });
  }

  try {
    const result = await renderPoster(data, variant, params.get('only') ?? undefined);
    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'image/png',
        'X-Poster-Height': String(result.height),
        'X-Poster-Cut': result.cut.join(', '),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Render failed.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
