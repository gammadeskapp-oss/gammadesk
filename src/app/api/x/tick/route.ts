import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules, priorSessionLabel } from '@/lib/events';
import { sendOwnerEmail } from '@/lib/health/email';
import { marketToday } from '@/lib/time';
import { ageMinutes, MAX_DATA_AGE_MIN } from '@/lib/x/compose';
import {
  consecutiveSkips,
  marketHoursStaleAlarm,
  nextAction,
  shouldAutoResume,
  summariseDay,
  type DayRow,
} from '@/lib/x/dispatch';
import { applyLockedLevels, decideIntraday, lockableLevels, phraseUsage } from '@/lib/x/intradaySchedule';
import { readIntradayState, recordIntradayPost, recordLockedLevels, markSummarySent, markStaleAlerted } from '@/lib/x/intradayStore';
import { readCachedDeskSnapshot, writeTickHeartbeat, type TickHeartbeat } from '@/lib/x/snapshotStore';
import { postingEnabled, runSlot, type RunOutcome } from '@/lib/x/run';
import { chicagoNow, isPostingDay } from '@/lib/x/schedule';
import { alreadyPosted, readLog, readPause, resume, storeStatus } from '@/lib/x/store';
import { cleanupOldImages } from '@/lib/x/imageStore';
import type { PostSlot } from '@/lib/x/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
/** A post quotes a live-ish price; older than this and the slot is held. */
const SPOT_POST_MAX_AGE_MIN = 30;

/**
 * The autonomous heartbeat. One Vercel cron wakes this every 5 minutes across
 * the trading day (see `vercel.json`); each wake decides for itself what, if
 * anything, is due — the morning template, an intraday update, the closing
 * template, or the 4:30 CT daily summary — and self-heals a pause.
 *
 * Everything the decision needs is pure (`nextAction`, `shouldAutoResume`); this
 * route just gathers the state, runs the chosen action, and records the result.
 * `?dry=1` reports the decision without acting.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const now = new Date();
  const rules = marketSessionRules();
  const date = marketToday(now);
  const clock = chicagoNow(now);

  if (!isPostingDay(date, rules)) {
    const reason = 'Not a full trading day (weekend, holiday, or early close).';
    if (!dry) {
      await writeTickHeartbeat({
        at: now.toISOString(), decision: 'idle', reason, outcome: null,
        stale: false, dataAgeMin: null, snapshotBuiltAt: null,
      });
    }
    return NextResponse.json({ status: 'skipped', reason });
  }

  // --- self-heal: auto-resume a stale "pause today" or an hourly auth re-test -
  let pause = await readPause().catch(() => ({ paused: false }));
  const autoResume = shouldAutoResume(pause, date, now);
  if (autoResume.resume && !dry) {
    pause = await resume(autoResume.reason ?? 'Auto-resumed.');
  }

  // --- gather the day's state -------------------------------------------------
  const log = await readLog().catch(() => []);
  // Read the ready-made snapshot the `/api/x/snapshot` cron writes — a fast Blob
  // read, no chain fetch or parse inside the tick. If it is missing or its market
  // data is past the freshness limit, the tick treats the feed as stale (which
  // surfaces in the heartbeat and holds any due post), rather than parsing a
  // chain inline and risking its own timeout.
  const cached = await readCachedDeskSnapshot().catch(() => null);
  const snapshot = cached?.snapshot ?? null;
  const dataAgeMin = snapshot ? ageMinutes(snapshot.dataIso, now) : null;
  const stale = dataAgeMin === null || dataAgeMin > MAX_DATA_AGE_MIN;

  // A post quotes a spot, so it holds to a tighter freshness bar than the 90-min
  // chain alarm: never post a price from a previous session, and never one more
  // than SPOT_POST_MAX_AGE_MIN old. Once the snapshot carries the price's real
  // timestamp (not the job's run time), a prior-session close shows up here as a
  // large age and is held — which is the whole point of the honest stamp.
  const priorSession = snapshot ? priorSessionLabel(snapshot.dataIso, now) : null;
  const postStale =
    dataAgeMin === null || dataAgeMin > SPOT_POST_MAX_AGE_MIN || priorSession !== null;

  const state = await readIntradayState(date);

  // The intraday levels are the morning's, locked for the day (or the first
  // intraday post's, if the morning was missed). Overlay them on the live
  // snapshot — price and movers stay live, the flip/support/resistance do not
  // drift per post and cannot re-fire an alert.
  const locked = state.lockedLevels ?? (snapshot ? lockableLevels(snapshot) : null);
  const intradaySnapshot = snapshot ? applyLockedLevels(snapshot, locked) : null;

  // "Wild/bigger moves" wording is allowed at most once an hour.
  const lastWild = Date.parse(state.lastWildIso ?? '');
  const allowWild = !Number.isFinite(lastWild) || now.getTime() - lastWild >= ONE_HOUR_MS;

  // Market-hours freshness alarm: SPY data over 90 min old while the regular
  // session is open, even though every fetch returned 200 and the nightly
  // health check reads "OK". Throttled to once an hour.
  if (!dry && marketHoursStaleAlarm({ hour: clock.hour, minute: clock.minute, stale, staleAlertedAt: state.staleAlertedAt, now })) {
    const ageLabel = snapshot ? `${Math.round(ageMinutes(snapshot.dataIso, now))} min old` : 'unavailable (no snapshot)';
    await sendOwnerEmail(
      'GammaDesk: SPY data STALE during market hours',
      [
        `The SPY snapshot behind /decision is ${ageLabel} while the market is open (limit ${MAX_DATA_AGE_MIN} min).`,
        'Every upstream fetch is still returning HTTP 200, so the nightly health check will not catch this.',
        '',
        'Most likely the Cboe delayed-quotes CDN is frozen (it keeps answering 200 with a stale timestamp).',
        'Failover only helps if a fresh secondary is configured — Polygon free has no open interest, so it cannot',
        'replace the chain. Check /api/health and /status.',
        '',
        'Decision page: https://www.gammadesk.app/decision',
      ].join('\n'),
    ).catch(() => ({ sent: false }));
    await markStaleAlerted(date, now);
  }

  const intraday = intradaySnapshot
    ? decideIntraday(intradaySnapshot, state, now)
    : { post: false as const, reason: 'No snapshot.' };

  const action = nextAction({
    hour: clock.hour,
    minute: clock.minute,
    morningPosted: await alreadyPosted('morning', date),
    closingPosted: await alreadyPosted('closing', date),
    summarySent: Boolean(state.summarySent),
    stale: postStale,
    intraday,
  });

  if (dry) {
    return NextResponse.json({
      status: 'dry',
      action,
      stale: postStale,
      priorSession,
      dataAgeMin: dataAgeMin === null ? null : Math.round(dataAgeMin),
      paused: pause.paused,
      autoResume,
    });
  }

  // Every non-dry tick records a heartbeat, so there are no more silent gaps:
  // "not due", "stale", and an actual post outcome are all visible from the
  // outside (surfaced in /api/health). The post log still holds only genuine
  // post attempts.
  const beat = (decision: string, reason: string, outcomeStr: string | null): TickHeartbeat => ({
    at: now.toISOString(),
    decision,
    reason,
    outcome: outcomeStr,
    stale: postStale,
    dataAgeMin: dataAgeMin === null ? null : Math.round(dataAgeMin),
    snapshotBuiltAt: cached?.builtAtIso ?? null,
  });

  // --- run the chosen action --------------------------------------------------
  let outcome: RunOutcome | null = null;

  if (action.kind === 'summary') {
    const rows: DayRow[] = log
      .filter((e) => e.date === date)
      .map((e) => ({ slot: e.slot, slotKey: e.slotKey, outcome: e.outcome, reason: e.reason, at: e.at }));
    const summary = summariseDay(rows, date);
    await sendOwnerEmail(summary.subject, summary.text).catch(() => ({ sent: false }));
    await markSummarySent(date);
    await writeTickHeartbeat(beat('summary', 'Daily summary sent.', 'sent'));
    return NextResponse.json({ status: 'summary-sent', summary: { sent: summary.sent, skipped: summary.skipped, failed: summary.failed }, store: storeStatus() });
  }

  if (action.kind === 'morning' || action.kind === 'closing') {
    const slot: PostSlot = { kind: action.kind, key: action.kind, label: action.kind === 'morning' ? 'Morning post (8:30 CT)' : 'Closing post (3:15 CT)' };
    outcome = await runSlot(slot, { now, ctx: { snapshot: snapshot ?? undefined } });
    // Lock the day's levels at the morning post: every intraday post after this
    // measures against these same numbers, rounded, all day.
    if (action.kind === 'morning' && outcome.status === 'sent' && snapshot) {
      await recordLockedLevels(date, lockableLevels(snapshot));
    }
    if (action.kind === 'closing' && outcome.status === 'sent') {
      await cleanupOldImages(now).catch(() => null);
    }
  } else if (action.kind === 'intraday' && intraday.post) {
    const usage = phraseUsage(
      log.map((e) => ({ slot: e.slot, outcome: e.outcome, at: e.at, phraseId: e.phraseId })),
      now.getTime() - FIVE_DAYS_MS,
    );
    const slot: PostSlot = {
      kind: 'intraday',
      key: intraday.slotKey,
      label: intraday.trigger ? `Intraday level break (${intraday.trigger})` : 'Intraday update',
    };
    outcome = await runSlot(slot, {
      now,
      ctx: { snapshot: intradaySnapshot ?? undefined, usedPhrases: state.usedPhrases, phraseUsage: usage, allowWild },
    });
    if (outcome.status === 'sent') {
      await recordIntradayPost(date, now, {
        trigger: intraday.trigger,
        phraseId: outcome.phraseId,
        wild: outcome.wild,
        // Lock the levels here too, in case the poster started mid-day and the
        // morning post never ran. `recordLockedLevels`/this both lock once.
        lockedLevels: locked ?? undefined,
        spyRspVerdict: outcome.spyRspVerdict,
        spyRspMentioned: outcome.spyRspMentioned,
      });
    }
  } else {
    // Nothing due (or waiting on stale data) — the common case, every 5 minutes.
    await writeTickHeartbeat(beat(action.kind, action.reason, null));
    return NextResponse.json({ status: action.kind, reason: action.reason, store: storeStatus() });
  }

  // --- self-report: 3+ skips in a row (only while genuinely trying) -----------
  if (outcome && (outcome.status === 'skipped' || outcome.status === 'failed') && postingEnabled() && !pause.paused) {
    const freshLog = await readLog().catch(() => log);
    const rows: DayRow[] = freshLog
      .filter((e) => e.date === date)
      .map((e) => ({ slot: e.slot, slotKey: e.slotKey, outcome: e.outcome, reason: e.reason, at: e.at }));
    if (consecutiveSkips(rows) === 3) {
      await sendOwnerEmail(
        'GammaDesk X: 3 posts skipped in a row',
        `Three X posts in a row were skipped or failed today (${date}). Latest: ${outcome.slot} — ${outcome.reason ?? 'no reason'}.\n\nLog: https://www.gammadesk.app/admin/x-posts`,
      ).catch(() => ({ sent: false }));
    }
  }

  await writeTickHeartbeat(beat(action.kind, action.reason, outcome?.status ?? null));
  return NextResponse.json({ action, ...outcome, store: storeStatus() });
}
