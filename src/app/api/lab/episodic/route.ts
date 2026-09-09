import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runEpisodicBackfill, runEpisodicScan } from '@/lib/episodic';
import { fetchDailyBarsDetailed } from '@/lib/episodic/bars';
import { episodicEnabled } from '@/lib/episodic/flag';
import { scanSeries } from '@/lib/episodic/scan';
import { EPISODIC_CAPTURE } from '@/lib/episodic/types';

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

  const params = new URL(request.url).searchParams;
  const wantsText = params.get('format') === 'text';

  /*
   * `?probe=SYM1,SYM2` — a diagnostic that runs the real fetch → scan path for
   * named symbols and returns what it found, without touching the store. It is
   * how the split handling and individual findings get audited by hand against
   * live data: for each name it reports the verdict, the declared and applied
   * splits, and — for any recent reverse split — the adjusted open-vs-prior-close
   * on the split date, which must be near zero rather than a fake gap. Gated by
   * the same flag and auth as the scan, since it spends the same upstream calls.
   */
  const probe = params.get('probe');
  if (probe) {
    const symbols = probe
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 25);

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const detailed = await fetchDailyBarsDetailed(symbol);
          if (!detailed) return { symbol, error: 'no data (unknown or delisted)' };
          const scan = scanSeries(symbol, null, detailed.bars, EPISODIC_CAPTURE);

          // For each applied split, show the adjusted gap across the split date —
          // this is the number that proves a reverse split was neutralised.
          const bars = detailed.bars;
          const splitChecks = detailed.applied.map((s) => {
            const i = bars.findIndex((b) => b.date >= s.date);
            const acrossGapPct =
              i > 0 ? (bars[i].open - bars[i - 1].close) / bars[i - 1].close : null;
            return {
              date: s.date,
              ratio: Number(s.ratio.toFixed(4)),
              reverse: s.ratio < 1,
              adjustedOpenVsPrevClosePct:
                acrossGapPct === null ? null : Number((acrossGapPct * 100).toFixed(1)),
            };
          });

          return {
            symbol,
            bars: bars.length,
            firstDate: bars[0]?.date,
            lastDate: bars[bars.length - 1]?.date,
            verdict: scan.kind === 'finding' ? 'FINDING' : `drop: ${scan.reason}`,
            finding:
              scan.kind === 'finding'
                ? {
                    gapDate: scan.finding.gapDate,
                    gapPct: Number((scan.finding.gapPct * 100).toFixed(1)),
                    volumeRatio: Number(scan.finding.volumeRatio.toFixed(1)),
                    dollarVolumeM: Number((scan.finding.dollarVolume / 1e6).toFixed(1)),
                    baseRangePct: Number((scan.finding.baseRangePct * 100).toFixed(1)),
                  }
                : null,
            declaredSplits: detailed.declared.length,
            appliedSplits: splitChecks,
          };
        } catch (error) {
          return { symbol, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );

    return NextResponse.json({ probe: results });
  }

  /*
   * `?mode=backfill&months=N` runs the scanner over the last N months of
   * history instead of the last 20 sessions, writing a browsable year of
   * findings plus the calibration report. Local-only in practice (the flag
   * gates it), and it runs longer than the daily scan — there is no function
   * timeout locally to fit inside.
   */
  if (params.get('mode') === 'backfill') {
    const monthsRaw = Number(params.get('months'));
    const months = Number.isFinite(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 24
      ? Math.floor(monthsRaw)
      : 12;
    const report = await runEpisodicBackfill(months);
    const c = report.calibration;
    const summary =
      `Backfilled ${report.months} months (from ${report.fromDate}) over ${report.scanned} of ${report.universeSize} names. ` +
      `${report.findingsTotal} findings at the defaults; ${c.trendRemoved} removed by the base-trend filter. ` +
      `${report.complete ? 'Complete pass.' : 'INCOMPLETE pass — counts are partial.'}` +
      `${report.stored ? '' : ' WARNING: results could not be stored.'}`;
    return NextResponse.json({ summary, report }, { status: report.stored ? 200 : 500 });
  }

  const report = await runEpisodicScan();

  const f = report.funnel;
  const summary =
    `Scanned ${f.scanned} of ${report.universeSize} names — ${f.survived} new finding(s), ` +
    `${report.totalFindings} tracked in total. ` +
    `Dropped: ${f.droppedShortHistory} short history, ${f.droppedLiquidity} illiquid, ` +
    `${f.droppedNoGap} no gap, ${f.droppedNotFresh} not fresh, ${f.droppedBaseTooWide} base too wide, ` +
    `${f.droppedBaseTrending} base trending, ${f.droppedBaseVolRising} base volume rising. ` +
    `${f.fetchFailed} fetch failure(s), ${f.notReached} not reached. ` +
    `${report.wrapped ? 'Full pass complete.' : `Next run resumes at ${report.cursor}.`}` +
    // The write result is the headline, not a footnote: a run that computed
    // findings but failed to store them looks identical to a good run in every
    // count above, and only this line tells them apart.
    `${report.stored ? '' : ' WARNING: the results could not be stored — nothing was persisted.'}` +
    `${report.durable ? '' : ' (Storage is not durable in this environment.)'}`;

  // Reflect a failed write in the status code too, so a scripted caller does
  // not read a 200 as "stored".
  if (!report.stored) {
    return wantsText
      ? new NextResponse(`${summary}\n`, {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      : NextResponse.json({ summary, report }, { status: 500 });
  }

  if (wantsText) {
    return new NextResponse(`${summary}\n`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.json({ summary, report });
}
