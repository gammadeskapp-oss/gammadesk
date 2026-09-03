import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { storeStatus } from '@/lib/jsonStore';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { checkSchedule } from '@/lib/scanner/schedule';
import { settleTrackRecord } from '@/lib/trackRecord/settle';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The 16:20 ET job: fill in one-, three- and five-day forward returns for
 * every pick still outstanding.
 *
 * Safe to run repeatedly and safe to run late — it only ever adds a horizon
 * that is missing, and never recomputes one that is already there. Five
 * minutes after the logging job so that a pick made today can have its anchor
 * close filled in on the same evening if the logger could not read it.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;

  if (params.get('when') === 'scheduled') {
    const check = checkSchedule(config.trackRecord.settleTimeEt, new Date());
    if (!check.due) {
      return NextResponse.json({
        status: 'skipped',
        summary: `Skipped: New York time is ${check.nowEt}, scheduled for ${config.trackRecord.settleTimeEt} ET.`,
        nowEt: check.nowEt,
      });
    }
  }

  try {
    const result = await settleTrackRecord();
    return NextResponse.json({
      ...result,
      summary: `Filled ${result.filled} forward return${result.filled === 1 ? '' : 's'} and ${result.closesFilled} closing price${result.closesFilled === 1 ? '' : 's'} across ${result.considered} outstanding entries.`,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Settling the track record failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
