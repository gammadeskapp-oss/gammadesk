import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/lib/tos/auth';
import { saveBrief, saveClosingBrief } from '@/lib/x/brief';
import { saveImage } from '@/lib/x/imageStore';
import { decodeImageField } from '@/lib/x/media';
import { validateBrief, validateClosingBrief } from '@/lib/x/text';

/**
 * Ingest the daily Cowork briefs — the morning "Desk" brief and the "Closing
 * Bell" brief — from the Cowork task.
 *
 * Auth is a shared secret in the `x-brief-token` header, compared in constant
 * time against the `BRIEF_TOKEN` env var (read at request time, never logged).
 * The body is untrusted off-platform input, so it is strictly validated before
 * anything is stored. Each `type` is saved separately, so a morning update
 * never clobbers a closing one.
 *
 * Body carries a `type`: "morning" (default) or "closing".
 *   morning: { type?, date, spy, qqq, iwm, vix, topStory, earningsToday[] }
 *            — spy/qqq/iwm are percent changes in points, vix the index level.
 *   closing: { type:"closing", date, spy, spyChangePct, qqq, qqqChangePct,
 *              iwm, iwmChangePct, vix, dayStory, topMovers[] }
 *            — spy/qqq/iwm are closing levels, *ChangePct the day's move.
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

  // Dispatch on `type`; a missing type is the morning brief (its original
  // contract, so the existing Cowork morning task keeps working unchanged).
  const type = (raw && typeof raw === 'object' ? (raw as { type?: unknown }).type : undefined) ?? 'morning';
  if (type !== 'morning' && type !== 'closing') {
    return NextResponse.json(
      { error: 'type must be "morning" or "closing".' },
      { status: 400, headers: NO_STORE },
    );
  }

  const now = new Date().toISOString();

  // The optional poster image rides in the same JSON body as base64. Validated
  // (PNG, ≤5 MB) before anything is stored; a bad image fails the whole request.
  const decoded = decodeImageField((raw as { image?: unknown }).image);
  if (!decoded.ok) {
    return NextResponse.json({ error: decoded.error ?? 'Invalid image.' }, { status: 400, headers: NO_STORE });
  }

  try {
    if (type === 'closing') {
      const result = validateClosingBrief(raw, now);
      if (!result.ok || !result.brief) {
        return NextResponse.json({ error: result.error ?? 'Invalid closing brief.' }, { status: 400, headers: NO_STORE });
      }
      await saveClosingBrief(result.brief);
      if (decoded.bytes) await saveImage(result.brief.date, 'closing', decoded.bytes);
      return NextResponse.json(
        { ok: true, type: 'closing', date: result.brief.date, movers: result.brief.topMovers.length, image: decoded.bytes ? { saved: true, bytes: decoded.bytes.length } : { saved: false } },
        { headers: NO_STORE },
      );
    }

    const result = validateBrief(raw, now);
    if (!result.ok || !result.brief) {
      return NextResponse.json({ error: result.error ?? 'Invalid brief.' }, { status: 400, headers: NO_STORE });
    }
    await saveBrief(result.brief);
    if (decoded.bytes) await saveImage(result.brief.date, 'morning', decoded.bytes);
    return NextResponse.json(
      { ok: true, type: 'morning', date: result.brief.date, earnings: result.brief.earningsToday.length, image: decoded.bytes ? { saved: true, bytes: decoded.bytes.length } : { saved: false } },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Could not store the brief.', detail: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: NO_STORE },
    );
  }
}
