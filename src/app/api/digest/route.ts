import { NextResponse } from 'next/server';
import {
  generateAndStoreDigest,
  postToDiscord,
  storeStatus,
  toDiscordMessage,
} from '@/lib/digest';
import { denyUnauthorisedCron } from '@/lib/log/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  const dry = new URL(request.url).searchParams.get('dry') === '1';

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
