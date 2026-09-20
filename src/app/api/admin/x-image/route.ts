import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { readImageBytes } from '@/lib/x/imageStore';
import { marketToday } from '@/lib/time';

/**
 * Owner-only stream of a stored poster image, so /admin/x-posts can render it.
 *
 * The images live in a private Blob store, so they cannot be shown by URL — this
 * route reads the bytes behind the same signed session cookie as the rest of the
 * admin console and returns them as image/png. `?type=morning|closing` and an
 * optional `?date=YYYY-MM-DD` (defaults to today) pick which one.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  if (type !== 'morning' && type !== 'closing') {
    return NextResponse.json({ error: 'type must be morning or closing.' }, { status: 400, headers: NO_STORE });
  }
  const dateParam = params.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : marketToday();

  const bytes = await readImageBytes(date, type).catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: 'No image.' }, { status: 404, headers: NO_STORE });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'image/png' },
  });
}
