import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { chicagoNow } from '@/lib/x/schedule';
import { runNightlyChecks } from '@/lib/health/run';
import { appendHealthReport } from '@/lib/health/store';
import { sendReportIfFailed } from '@/lib/health/email';

/**
 * The nightly GammaDesk health check — runs at 9:00 PM CT every day.
 *
 * Registered at both 02:00 and 03:00 UTC in `vercel.json` so 21:00 Central is
 * covered in summer (CDT) and winter (CST); the route reads the real Chicago
 * clock and only the 21:xx firing does the work. The other firing sees the
 * wrong hour and returns without spending anything — the same DST-safe pattern
 * the X posting crons use.
 *
 * It checks the public pages, the data feeds, that today's posts and briefs
 * arrived, that the env and Blob store are healthy, and that /daily is not
 * stale. The last 30 days of results are stored (and shown on /admin/x-posts).
 * An email goes to gammadesk.app@gmail.com ONLY when something failed — silence
 * means all is well.
 *
 * `?force=1` runs regardless of the clock (used to run the check by hand).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const HEALTH_HOUR_CT = 21; // 9:00 PM Central

export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const force = params.get('force') === '1';
  // `dry` runs every check but neither stores the result nor sends any email —
  // for verifying the check by hand without writing history or mailing a report.
  const dry = params.get('dry') === '1';
  const now = new Date();

  if (!force && !dry && chicagoNow(now).hour !== HEALTH_HOUR_CT) {
    return NextResponse.json({ status: 'skipped', reason: 'Not the 9:00 PM CT health-check slot.' });
  }

  const baseUrl = new URL(request.url).origin;
  const report = await runNightlyChecks(baseUrl, now);

  let mail: Awaited<ReturnType<typeof sendReportIfFailed>> | { sent: false; skipped: string } = {
    sent: false,
    skipped: 'Dry run — no email.',
  };
  if (!dry) {
    // Store first, so the result survives even if the email step throws.
    await appendHealthReport(report).catch(() => {});
    mail = await sendReportIfFailed(report);
  }

  return NextResponse.json({
    status: dry ? 'dry-run' : 'ran',
    date: report.date,
    total: report.total,
    failed: report.failed,
    checks: report.checks,
    email: mail,
  });
}
