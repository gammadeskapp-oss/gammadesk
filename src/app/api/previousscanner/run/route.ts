import { NextResponse } from 'next/server';
import { legacyScannerEnabled } from '@/lib/pageFlag';
import { legacyConfig as config } from '@/lib/previousscanner/config';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runScanner, storeStatus } from '@/lib/previousscanner';
import { partition } from '@/lib/previousscanner/evaluate';
import { checkSchedule } from '@/lib/previousscanner/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Force the legacy scan to re-run, by hand.
 *
 * **There is no cron entry for this and there must not be one** — the Vercel
 * cron slots are full, and this page is kept for reference rather than run as
 * a job. `/previousscanner` computes its own scan the first time it is asked
 * for each day and stores it; this endpoint exists only to redo that, and
 * keeps the same dual-auth and the same `?format=text` as the other manual
 * endpoints so it cannot be walked by anyone who finds the URL.
 *
 * It is gated on `GAMMADESK_LEGACY_SCANNER=1` before the auth check, the same
 * way `/api/lab/analogue` is gated on its page's flag. Without the flag this
 * answers 404 and never reaches the token comparison, so a deploy that does
 * not serve the page cannot be made to run its scan either — the page and its
 * one endpoint are switched on and off together, which is the only arrangement
 * where "this page is off" is a true statement about the whole feature.
 *
 * The `when=scheduled` branch below is inherited from the original and is
 * dead here: nothing schedules this. It is left in place because the point of
 * the page is to show what the old build did, and quietly editing its
 * plumbing is how a restoration stops being one.
 *
 * The summary counts passes at the shipped default strictness ("all three
 * timeframes agree"). The stored scan keeps every filter state for every
 * candidate, so the page can re-count at a different strictness without this
 * job running again — but a summary has to pick one, and it picks the default
 * rather than the most flattering.
 */
export async function GET(request: Request) {
  if (!legacyScannerEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

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
    const { passed, nearMisses } = partition(result.rows, 'all');

    const summary = result.gateReason
      ? `Scan empty: SPY gamma negative. ${result.candidates} candidates evaluated, ${nearMisses.length} blocked only by that.`
      : `Scanned ${result.candidates} of ${result.universe} — ${passed.length} passed, ` +
        `${nearMisses.length} missed by one. Gamma as of ${result.gammaRefreshedAt ? result.gammaDate : 'no same-day refresh'}.`;

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
      candidates: result.candidates,
      passed: passed.map((p) => p.row.symbol),
      nearMisses: nearMisses.map((p) => ({
        symbol: p.row.symbol,
        missing: p.outcome.failingLabel,
      })),
      spyRegime: result.spyRegime,
      gateReason: result.gateReason,
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
