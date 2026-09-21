import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { sendDailyBrief } from '@/lib/email/sendBrief';
import { marketNow, marketToday } from '@/lib/time';
import { operatorDetail } from '@/lib/errorText';

/**
 * Emails the morning brief to the audience, once per trading day.
 *
 * The Cowork morning brief lands around 8:20 CT, so this is scheduled a little
 * after (see vercel.json). Vercel schedules crons in UTC only, so — as the
 * other daily jobs do — there are two entries, one for each of the UTC hours
 * that maps to the morning across DST, and this refuses to run before 8am
 * market time unless forced. The send marker makes the second entry a no-op.
 *
 * If there is no brief for today, it sends nothing. `?force=1` bypasses both
 * the hour guard and the once-a-day marker, for a manual re-send.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const EARLIEST_HOUR = 8;

export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const force = new URL(request.url).searchParams.get('force') === '1';
  const now = marketNow();
  const today = marketToday();

  if (!force && now.hour < EARLIEST_HOUR) {
    return NextResponse.json({ sent: false, reason: 'too-early', hour: now.hour });
  }

  try {
    const outcome = await sendDailyBrief(today, { force });
    return NextResponse.json(outcome);
  } catch (error) {
    console.error('[cron/email-brief] failed:', operatorDetail(error));
    return NextResponse.json(
      { sent: false, reason: 'error', detail: operatorDetail(error) },
      { status: 502 },
    );
  }
}
