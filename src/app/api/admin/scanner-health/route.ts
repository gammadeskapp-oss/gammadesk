import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { config } from '@/lib/config';
import { averagePerDay, dailyCounts, readArchive } from '@/lib/scanner/archive';
import { peekEarnings } from '@/lib/scanner/earningsStore';
import { peekScannerGamma } from '@/lib/scanner/gamma';
import { peekPipeline, STEP_ORDER } from '@/lib/scanner/pipeline';
import { readLatestScan, readTodaysScan } from '@/lib/scanner/run';
import { storeStatus } from '@/lib/jsonStore';
import { marketToday } from '@/lib/time';

/**
 * Owner-only health data for /admin/scanner.
 *
 * Reads stored documents only — the pipeline state, the gamma/earnings/scan
 * stores, and the archive — so it is fast and never triggers any work. Guarded
 * by the same signed session cookie as the rest of /admin.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: NextRequest) {
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  const today = marketToday();
  const [pipeline, gamma, earnings, scan, latest, archive] = await Promise.all([
    peekPipeline(),
    peekScannerGamma(),
    peekEarnings(),
    readTodaysScan(),
    readLatestScan(),
    readArchive().catch(() => []),
  ]);

  const tuning = config.scanner;

  return NextResponse.json(
    {
      today,
      store: storeStatus(),
      schedule: {
        gamma: tuning.gammaTimeEt,
        earnings: tuning.earningsTimeEt,
        scan: tuning.scanTimeEt,
        contracts: tuning.contractsTimeEt,
        healthDeadline: tuning.healthDeadlineEt,
      },
      stepOrder: STEP_ORDER,
      pipeline: pipeline && pipeline.date === today ? pipeline : null,
      pipelineStale: pipeline && pipeline.date !== today ? pipeline : null,
      gamma: gamma
        ? {
            date: gamma.date,
            refreshedAt: gamma.refreshedAt,
            requested: gamma.requested,
            refreshed: Object.keys(gamma.symbols).length,
            failures: gamma.failures,
            source: gamma.source ?? null,
          }
        : null,
      earnings: earnings
        ? {
            date: earnings.date,
            fetchedAt: earnings.fetchedAt,
            dated: earnings.dated,
            requested: earnings.requested,
            source: earnings.source,
          }
        : null,
      scan: (scan ?? latest)
        ? {
            date: (scan ?? latest)!.date,
            isToday: Boolean(scan),
            scannedAt: (scan ?? latest)!.scannedAt,
            scored: (scan ?? latest)!.scored,
            universe: (scan ?? latest)!.universe,
            withGamma: (scan ?? latest)!.coverage?.withGamma ?? null,
            qualityChecked: (scan ?? latest)!.qualityChecked,
            qualityTargeted: (scan ?? latest)!.qualityTargeted,
            qualityFailures: (scan ?? latest)!.qualityFailures,
            notes: (scan ?? latest)!.notes,
          }
        : null,
      runRate: {
        counts: dailyCounts(archive),
        average: averagePerDay(archive),
      },
    },
    { headers: NO_STORE },
  );
}
