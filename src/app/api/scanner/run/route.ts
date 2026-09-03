import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runScanner, storeStatus } from '@/lib/scanner';
import { DEFAULT_FILTERS, scoreAndJudge } from '@/lib/scanner/score';
import { checkSchedule } from '@/lib/scanner/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The 09:35 ET scan — see `vercel.json`, and the manual endpoint for the same
 * job. Same dual-auth and same `?format=text` as the gamma route.
 *
 * The summary counts passes at the shipped default strictness ("all three
 * timeframes agree"). The stored scan keeps every filter state for every
 * candidate, so the page can re-count at a different strictness without this
 * job running again — but a summary has to pick one, and it picks the default
 * rather than the most flattering.
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
    const check = checkSchedule(config.scanner.scanTimeEt, new Date());
    if (!check.due) {
      const message = `Skipped: New York time is ${check.nowEt}, scheduled for ${config.scanner.scanTimeEt} ET.`;
      return wantsText
        ? new NextResponse(`${message}
`, {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        : NextResponse.json({ summary: message, status: 'skipped', nowEt: check.nowEt });
    }
  }

  try {
    const result = await runScanner();
    const passed = scoreAndJudge(result.rows, DEFAULT_FILTERS, {
      spyRegime: result.spyRegime,
    }).filter(
      (entry) => entry.passes && !entry.earningsExcluded,
    );

    const summary =
      `Scored ${result.scored} of ${result.universe} — ${passed.length} match every filter on at the defaults, ` +
      `${result.earningsExcluded.length} reporting inside the earnings buffer, ` +
      `${result.qualityChecked} of ${result.qualityTargeted} contracts graded. ` +
      `Market regime ${result.spyRegime ?? 'unknown'}. ` +
      `Gamma as of ${result.gammaRefreshedAt ? result.gammaDate : 'no same-day refresh'}.`;

    if (wantsText) {
      return new NextResponse(`${summary}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({
      summary,
      status: 'scanned',
      date: result.date,
      scannedAt: result.scannedAt,
      universe: result.universe,
      scored: result.scored,
      passed: passed.map((entry) => ({
        symbol: entry.row.symbol,
        score: Math.round(entry.score.total),
        rs: Math.round(entry.row.metrics.rsScore),
        option: entry.row.optionQuality?.badge ?? 'not checked',
      })),
      earningsExcluded: result.earningsExcluded,
      earningsSource: result.earningsSource,
      qualityChecked: result.qualityChecked,
      spyRegime: result.spyRegime,
      qualityTargeted: result.qualityTargeted,
      qualityFailures: result.qualityFailures,
      gammaDate: result.gammaDate,
      notes: result.notes,
      store: storeStatus(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    // Non-200, never a plausible-looking empty scan. An empty list is a real
    // and meaningful result on this page, so a broken run must not be able to
    // masquerade as one.
    if (wantsText) {
      return new NextResponse(`Scan FAILED: ${detail}\n`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json(
      { summary: `Scan failed: ${detail}`, error: 'Scanner run failed.', detail },
      { status: 500 },
    );
  }
}
