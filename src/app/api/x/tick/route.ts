import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules } from '@/lib/events';
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
import { loadDeskSnapshot } from '@/lib/x/deskData';
import { applyLockedLevels, decideIntraday, lockableLevels, phraseUsage } from '@/lib/x/intradaySchedule';
import { readIntradayState, recordIntradayPost, recordLockedLevels, markSummarySent, markStaleAlerted } from '@/lib/x/intradayStore';
import { postingEnabled, runSlot, type RunOutcome } from '@/lib/x/run';
import { chicagoNow, isPostingDay } from '@/lib/x/schedule';
import { alreadyPosted, readLog, readPause, resume, storeStatus } from '@/lib/x/store';
import { cleanupOldImages } from '@/lib/x/imageStore';
import type { PostSlot } from '@/lib/x/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

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
    return NextResponse.json({ status: 'skipped', reason: 'Not a full trading day (weekend, holiday, or early close).' });
  }

  // --- self-heal: auto-resume a stale "pause today" or an hourly auth re-test -
  let pause = await readPause().catch(() => ({ paused: false }));
  const autoResume = shouldAutoResume(pause, date, now);
  if (autoResume.resume && !dry) {
    pause = await resume(autoResume.reason ?? 'Auto-resumed.');
  }

  // --- gather the day's state -------------------------------------------------
  const log = await readLog().catch(() => []);
  const snapshot = await loadDeskSnapshot(now).catch(() => null);
  const stale = !snapshot || ageMinutes(snapshot.dataIso, now) > MAX_DATA_AGE_MIN;

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
    stale,
    intraday,
  });

  if (dry) {
    return NextResponse.json({ status: 'dry', action, stale, paused: pause.paused, autoResume });
  }

  // --- run the chosen action --------------------------------------------------
  let outcome: RunOutcome | null = null;

  if (action.kind === 'summary') {
    const rows: DayRow[] = log
      .filter((e) => e.date === date)
      .map((e) => ({ slot: e.slot, slotKey: e.slotKey, outcome: e.outcome, reason: e.reason, at: e.at }));
    const summary = summariseDay(rows, date);
    await sendOwnerEmail(summary.subject, summary.text).catch(() => ({ sent: false }));
    await markSummarySent(date);
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
      });
    }
  } else {
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

  return NextResponse.json({ action, ...outcome, store: storeStatus() });
}
