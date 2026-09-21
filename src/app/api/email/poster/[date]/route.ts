import { NextResponse, type NextRequest } from 'next/server';
import { readImageBytes } from '@/lib/x/imageStore';

/**
 * Public, read-only view of a day's morning poster PNG.
 *
 * Email clients load images by URL and cannot present a Vercel-blob private
 * link, so the brief email points its <img> here. This is safe to be public:
 * the same poster is posted to X every morning, so it is already public — this
 * only re-serves bytes we already published, and nothing else.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_request: NextRequest, ctx: { params: Promise<{ date: string }> }) {
  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: 'Bad date.' }, { status: 400 });
  }

  const bytes = await readImageBytes(date, 'morning').catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: 'No poster for that date.' }, { status: 404 });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Posters are immutable once published; let mail proxies cache them.
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
