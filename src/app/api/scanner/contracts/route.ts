import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { gradeStoredScanContracts } from '@/lib/scanner/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The contract-grading step, callable on its own.
 *
 * Normally driven by the pipeline tick at 09:40 ET (see `vercel.json` and
 * `lib/scanner/pipeline.ts`); exposed here so a missed or failed grading pass
 * can be re-run by hand against today's stored scan without re-scoring the
 * whole index. Idempotent — it no-ops if the scan is already graded.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const wantsText = new URL(request.url).searchParams.get('format') === 'text';

  try {
    const outcome = await gradeStoredScanContracts();
    const summary =
      outcome.date === null
        ? 'No stored scan for today — nothing to grade.'
        : `Graded ${outcome.graded} of ${outcome.targeted} top names` +
          (outcome.failures.length > 0 ? `, ${outcome.failures.length} chain requests failed` : '') +
          (outcome.skipped.length > 0 ? `, ${outcome.skipped.length} not reached in time` : '') +
          '.';

    if (wantsText) {
      return new NextResponse(`${summary}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return NextResponse.json({ summary, ...outcome });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { summary: `Contract grading failed: ${detail}`, error: 'Contract grading failed.', detail },
      { status: 500 },
    );
  }
}
