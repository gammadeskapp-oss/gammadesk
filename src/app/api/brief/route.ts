import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/lib/tos/auth';
import { saveBrief } from '@/lib/x/brief';
import { validateBrief } from '@/lib/x/text';

/**
 * Ingest the daily "Morning Desk" brief from the Cowork task.
 *
 * Auth is a shared secret in the `x-brief-token` header, compared in constant
 * time against the `BRIEF_TOKEN` env var (read at request time, never logged).
 * The body is untrusted off-platform input, so it is strictly validated before
 * anything is stored. On success the brief is saved to Blob as today's brief;
 * the 8:25 CT morning post reads it.
 *
 * Body: { date: "YYYY-MM-DD", spy, qqq, iwm, vix, topStory, earningsToday[] }
 * where spy/qqq/iwm are percent changes in points and vix is the index level.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

function briefToken(): string | null {
  const value = process.env['BRIEF_TOKEN'];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  const expected = briefToken();
  if (!expected) {
    return NextResponse.json(
      { error: 'BRIEF_TOKEN is not configured.' },
      { status: 503, headers: NO_STORE },
    );
  }

  const provided = (request.headers.get('x-brief-token') ?? '').trim();
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401, headers: NO_STORE });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400, headers: NO_STORE });
  }

  const result = validateBrief(raw, new Date().toISOString());
  if (!result.ok || !result.brief) {
    return NextResponse.json({ error: result.error ?? 'Invalid brief.' }, { status: 400, headers: NO_STORE });
  }

  try {
    await saveBrief(result.brief);
  } catch (error) {
    return NextResponse.json(
      { error: 'Could not store the brief.', detail: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { ok: true, date: result.brief.date, earnings: result.brief.earningsToday.length },
    { headers: NO_STORE },
  );
}
