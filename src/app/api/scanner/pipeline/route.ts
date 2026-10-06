import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { STEP_LABEL, STEP_ORDER, tickPipeline } from '@/lib/scanner/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The morning pipeline tick — see `vercel.json`, where one cron fires this
 * every five minutes through the morning window, and `lib/scanner/pipeline.ts`
 * for the state machine it drives.
 *
 * Each tick runs at most one step (gamma → earnings → scan → contracts),
 * retries a failed step on later ticks, skips weekends and holidays, and emails
 * the owner once if the scan has not stored by the deadline or too many chains
 * failed. Safe to call manually at any time; it only ever runs the step that is
 * actually due.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const wantsText = new URL(request.url).searchParams.get('format') === 'text';

  try {
    const result = await tickPipeline();

    const line = result.ran
      ? `Ran ${result.ran}: ${result.state.steps[result.ran].status}` +
        (result.state.steps[result.ran].summary ? ` — ${result.state.steps[result.ran].summary}` : '')
      : `Nothing to run${result.skippedReason ? ` — ${result.skippedReason}` : ''}`;

    if (wantsText) {
      const steps = STEP_ORDER.map(
        (s) =>
          `  ${STEP_LABEL[s]}: ${result.state.steps[s].status}` +
          (result.state.steps[s].summary ? ` — ${result.state.steps[s].summary}` : ''),
      ).join('\n');
      return new NextResponse(`${line}\n\n${steps}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({
      summary: line,
      date: result.date,
      ran: result.ran,
      skippedReason: result.skippedReason,
      healthAlerted: result.healthAlerted,
      steps: result.state.steps,
      health: result.state.health,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (wantsText) {
      return new NextResponse(`Pipeline tick FAILED: ${detail}\n`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return NextResponse.json(
      { summary: `Pipeline tick failed: ${detail}`, error: 'Pipeline tick failed.', detail },
      { status: 500 },
    );
  }
}
