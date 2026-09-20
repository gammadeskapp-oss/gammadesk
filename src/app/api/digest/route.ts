import { NextResponse } from 'next/server';
import {
  generateAndStoreDigest,
  postToDiscord,
  storeStatus,
  toDiscordMessage,
} from '@/lib/digest';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { runSlot } from '@/lib/x/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The closing X post rides on this existing task rather than a new cron — the
 * brief asks the closing snapshot to hook into the digest job. Its own ledger,
 * self-checks and guards apply; it never throws.
 */
const CLOSING_X_SLOT = { kind: 'closing' as const, key: 'closing', label: 'Closing snapshot' };

/**
 * Builds the daily digest, stores it, and posts it to Discord.
 * Driven by Vercel Cron — see `vercel.json`.
 *
 * `?dry=1` builds and stores without posting, for checking the wording
 * before it reaches a channel.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  // Independent of the Discord digest below; own ledger and guards. Never throws.
  const xPost = await runSlot(CLOSING_X_SLOT, { dry, force });

  try {
    const digest = await generateAndStoreDigest();
    const delivery = dry
      ? { delivered: false, reason: 'Dry run — nothing was posted.' }
      : await postToDiscord(digest);

    return NextResponse.json({
      status: 'generated',
      date: digest.date,
      generatedAt: digest.generatedAt,
      discord: delivery,
      xPost,
      // Exactly what was, or would have been, posted — so the wording can be
      // reviewed before it reaches a channel.
      message: toDiscordMessage(digest),
      digest: {
        spot: digest.spot,
        regime: digest.regime,
        flipLevel: digest.flipLevel,
        odds3d: digest.odds3d,
        odds10d: digest.odds10d,
        crashPct: digest.crashPct,
        riskLabel: digest.riskLabel,
        leaders: digest.leaders,
        laggards: digest.laggards,
        notes: digest.notes,
      },
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Digest generation failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
