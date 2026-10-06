import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runEarningsStep } from '@/lib/scanner/earningsStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The earnings-dates step, callable on its own.
 *
 * Normally driven by the pipeline tick at 09:00 ET; exposed here so the
 * whole-index earnings lookup can be re-run by hand. The scan reads this
 * step's stored result, and falls back to its own inline lookup if it is
 * missing — see `lib/scanner/earningsStore.ts`.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const wantsText = new URL(request.url).searchParams.get('format') === 'text';

  try {
    const outcome = await runEarningsStep();
    const summary = `Dated ${outcome.dated} of ${outcome.requested} ranked names. ${outcome.source}`;
    if (wantsText) {
      return new NextResponse(`${summary}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return NextResponse.json({ summary, ...outcome });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { summary: `Earnings step failed: ${detail}`, error: 'Earnings step failed.', detail },
      { status: 500 },
    );
  }
}
