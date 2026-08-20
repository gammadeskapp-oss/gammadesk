import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { refreshScannerGamma, scanCandidates, storeStatus } from '@/lib/scanner';
import { checkSchedule } from '@/lib/scanner/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The 08:30 ET gamma refresh for scanner candidates — see `vercel.json`.
 *
 * Also the manual endpoint for the same job: `denyUnauthorisedCron` accepts
 * either the bearer token Vercel Cron sends or `?token=` in the query, so this
 * one route serves both without a second copy of the logic. It is deliberately
 * not linked anywhere in the UI — it spends most of a Cboe window.
 *
 * `?format=text` returns the one-line summary as plain text, which is what is
 * actually readable when the job is being poked from a phone.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const wantsText = params.get('format') === 'text';

  /*
   * Cron entries carry `when=scheduled` and are registered at both candidate
   * UTC times, so exactly one of them lands on the right New York clock —
   * see `lib/scanner/schedule.ts`. Manual calls omit it and always run.
   */
  if (params.get('when') === 'scheduled') {
    const check = checkSchedule(config.scanner.gammaTimeEt, new Date());
    if (!check.due) {
      const message = `Skipped: New York time is ${check.nowEt}, scheduled for ${config.scanner.gammaTimeEt} ET.`;
      return wantsText
        ? new NextResponse(`${message}
`, {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        : NextResponse.json({ summary: message, status: 'skipped', nowEt: check.nowEt });
    }
  }

  try {
    const { rows } = await scanCandidates();

    /*
     * `?dry=1` reports the candidate list without fetching a single chain.
     *
     * The budget is the whole constraint on this job, and it is worth being
     * able to check that the list still fits inside a Cboe window — after an
     * RS floor change, say — without spending the window to find out.
     */
    if (params.get('dry') === '1') {
      const budget = config.scanner.gammaRefreshBudget;
      const wanted = rows.length + (rows.some((r) => r.symbol === 'SPY') ? 0 : 1);
      const message =
        `Dry run: ${rows.length} names clear RS ${config.scanner.rsMin}. ` +
        `With SPY that is ${wanted} chains against a budget of ${budget}` +
        (wanted > budget ? ` — ${wanted - budget} would be skipped.` : '.');

      return wantsText
        ? new NextResponse(`${message}
`, {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        : NextResponse.json({
            summary: message,
            status: 'dry-run',
            candidates: rows.map((r) => r.symbol),
            budget,
          });
    }

    const outcome = await refreshScannerGamma(rows.map((r) => r.symbol));

    const spy = outcome.stored.symbols.SPY;
    const summary =
      `Refreshed ${outcome.refreshed} chains, ${outcome.failed} failed` +
      (outcome.skipped > 0 ? `, ${outcome.skipped} skipped` : '') +
      `. SPY gamma ${spy ? spy.regime : 'unread'}.`;

    if (wantsText) {
      return new NextResponse(`${summary}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({
      summary,
      status: 'refreshed',
      date: outcome.stored.date,
      candidates: rows.length,
      requested: outcome.requested,
      refreshed: outcome.refreshed,
      failed: outcome.failed,
      skipped: outcome.skipped,
      spyRegime: spy?.regime ?? null,
      failures: outcome.stored.failures,
      store: storeStatus(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    /*
     * A non-200 on failure, always. This job's output decides filters 3, 4 and
     * 5, and a 200 carrying an empty document would let the scan an hour later
     * read it as "no positive gamma anywhere" instead of "the refresh broke".
     */
    if (wantsText) {
      return new NextResponse(`Gamma refresh FAILED: ${detail}\n`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json(
      {
        summary: `Gamma refresh failed: ${detail}`,
        error: 'Scanner gamma refresh failed.',
        detail,
      },
      { status: 500 },
    );
  }
}
