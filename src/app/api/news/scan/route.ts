import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runScan } from '@/lib/news/scan';
import { scanWindow } from '@/lib/news/schedule';
import { saveScan, storeStatus } from '@/lib/news/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The news scan, driven by Vercel Cron every 15 minutes across the UTC hours
 * that cover 06:00–15:30 CT — see `vercel.json`. The America/Chicago window gate
 * lives in code (`scanWindow`) so a DST change never shifts it and a firing at
 * the wrong hour skips cleanly.
 *
 * Guarded by CRON_SECRET like every other write endpoint. `?dry=1` runs the real
 * pipeline but stores nothing (for previewing what a scan would pick); `?force=1`
 * ignores the time-of-day window (for the 5-day backfill and manual checks).
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const now = new Date();
  const window = scanWindow(now);
  if (!force && !window.open) {
    return NextResponse.json({ status: 'skipped', reason: window.reason, clock: window.clock });
  }

  try {
    const result = await runScan(now);
    if (!dry) await saveScan(result);

    return NextResponse.json({
      status: dry ? 'preview' : 'stored',
      date: result.date,
      scannedAt: result.scannedAt,
      picked: result.top.length,
      ranked: result.ranked.length,
      sources: result.sources,
      top: result.top,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'News scan failed.', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
