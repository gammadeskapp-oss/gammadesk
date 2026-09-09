import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runEpisodicScan } from '@/lib/episodic';
import { episodicEnabled } from '@/lib/episodic/flag';

/**
 * Run the episodic-pivot scan, by hand.
 *
 * ## Two gates, for two different failures
 *
 * `episodicEnabled()` first — which is `/lab`'s `GAMMADESK_LAB` switch. Without
 * it this answers 404 and never reaches the auth check, so an accidental deploy
 * ships a route that does not exist rather than one that is merely locked. Then
 * `denyUnauthorisedCron`, the same guard every manual endpoint here carries:
 * this spends a year of daily bars for thousands of symbols, and an endpoint
 * that does that has no business being openly callable even behind a flag.
 *
 * ## There is no cron entry, and there must not be one
 *
 * `vercel.json` does not schedule this, on purpose. In production the flag is
 * off, so a scheduled call would 404; and the scan is a local-only research
 * sweep across the whole common-stock universe, spending far more upstream
 * requests than anything the site runs against its own quota-limited feeds. It
 * is triggered by hand locally with `?token=`, the same way the analogue load
 * on /lab is. Running it after the close is a matter of when the operator
 * fires it, not a schedule.
 *
 * ## Local only, in practice
 *
 * Yahoo is the bar source, so this does not itself need `TRADIER_TOKEN`. But
 * because the flag gates it to environments somebody has deliberately switched
 * on, and production never is, the sweep only ever actually runs on a local
 * machine — which is where a several-thousand-request job belongs.
 */

export const dynamic = 'force-dynamic';

/**
 * Thousands of one-year bar pulls at concurrency 24. The scan's own wall-clock
 * budget stops it well before this, but the platform ceiling has to be the
 * maximum so a near-full sweep is not killed mid-write.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!episodicEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const wantsText = new URL(request.url).searchParams.get('format') === 'text';

  const report = await runEpisodicScan();

  const f = report.funnel;
  const summary =
    `Scanned ${f.scanned} of ${report.universeSize} names — ${f.survived} new finding(s), ` +
    `${report.totalFindings} tracked in total. ` +
    `Dropped: ${f.droppedShortHistory} short history, ${f.droppedLiquidity} illiquid, ` +
    `${f.droppedNoGap} no gap, ${f.droppedNotFresh} not fresh, ${f.droppedBaseNotQuiet} base not quiet. ` +
    `${f.fetchFailed} fetch failure(s), ${f.notReached} not reached. ` +
    `${report.wrapped ? 'Full pass complete.' : `Next run resumes at ${report.cursor}.`}` +
    `${report.durable ? '' : ' Storage is not durable in this environment.'}`;

  if (wantsText) {
    return new NextResponse(`${summary}\n`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.json({ summary, report });
}
