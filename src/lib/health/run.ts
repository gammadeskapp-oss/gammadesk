import 'server-only';

import { getPositioning, secondaryChainSource } from '../positioning';
import { config } from '../config';
import { snapshotStaleness, marketSessionRules } from '../events';
import { isTradingDay } from '../x/schedule';
import { fetchCboeQuote } from '../x/cboeQuote';
import { readBriefForDate, readClosingBriefForDate } from '../x/brief';
import { readLog, readPause } from '../x/store';
import { postingEnabled } from '../x/run';
import { storeStatus } from '../jsonStore';
import { probeBlobWrite } from './store';
import { marketToday } from '../time';
import {
  evaluateExpectedPosts,
  missingEnv,
  toReport,
  type HealthCheck,
  type HealthReport,
} from './report';

/**
 * The nightly health check, run end to end.
 *
 * Each check is independent and defensive: one failing feed produces a red
 * mark on its own row, never a thrown error that takes the whole run down. The
 * result is a `HealthReport` the caller stores, shows on the admin console, and
 * (only when something failed) emails.
 */

/** The public pages that must render — a 500 or a build break shows here. */
const PAGES: Array<{ id: string; label: string; path: string }> = [
  { id: 'page:home', label: 'Home page returns 200', path: '/' },
  { id: 'page:daily', label: '/daily returns 200', path: '/daily' },
  { id: 'page:scanner', label: '/scanner returns 200', path: '/scanner' },
  { id: 'page:admin', label: '/admin/x-posts returns 200', path: '/admin/x-posts' },
];

async function checkPage(baseUrl: string, path: string, label: string, id: string): Promise<HealthCheck> {
  try {
    const res = await fetch(new URL(path, baseUrl).toString(), {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'GammaDesk-HealthCheck' },
    });
    return {
      id,
      label,
      ok: res.status === 200,
      detail: res.status === 200 ? 'Responded 200.' : `Responded HTTP ${res.status}.`,
    };
  } catch (error) {
    return { id, label, ok: false, detail: `Request failed: ${error instanceof Error ? error.message : String(error)}.` };
  }
}

async function checkBlobWritable(): Promise<HealthCheck> {
  const id = 'infra:blob';
  const label = 'Vercel Blob is writable';
  const status = storeStatus();
  if (status.kind !== 'blob') {
    // No Blob token: fine locally, a real problem on Vercel (writes are lost).
    return process.env.VERCEL
      ? { id, label, ok: false, detail: 'No Blob store on this deployment — stored data will not survive a redeploy.' }
      : { id, label, ok: true, detail: 'Local file store (no Blob token) — not applicable.' };
  }
  try {
    // Goes through the shared store path, which uses the store's own access
    // mode (private first) — never a hard-coded `access: 'public'` that a
    // private store rejects with "Cannot use public access on a private store".
    await probeBlobWrite();
    return { id, label, ok: true, detail: 'Wrote a probe object successfully.' };
  } catch (error) {
    return { id, label, ok: false, detail: `Write failed: ${error instanceof Error ? error.message : String(error)}.` };
  }
}

export async function runNightlyChecks(baseUrl: string, now: Date = new Date()): Promise<HealthReport> {
  const date = marketToday(now);
  const rules = marketSessionRules();
  const tradingDay = isTradingDay(date, rules);

  const checks: HealthCheck[] = [];

  // 1–4: the public pages render.
  const pageChecks = await Promise.all(PAGES.map((p) => checkPage(baseUrl, p.path, p.label, p.id)));
  checks.push(...pageChecks);

  // 5 + 11: the chain data source (Polygon/Cboe) responds, and the snapshot it
  // returns is not stale — computed from one fetch.
  try {
    const positioning = await getPositioning();
    checks.push({ id: 'data:chain', label: 'Chain data source (Polygon/Cboe) responds', ok: true, detail: 'Positioning snapshot loaded.' });
    const staleness = snapshotStaleness(positioning.meta.quoteDateIso, now);
    // Naming the source that actually answered reveals whether failover engaged:
    // a "fresh, via Polygon.io" line when the primary is Cboe means the stale-
    // feed fallback did its job on this refresh.
    const via = positioning.meta.sourceLabel;
    checks.push({
      id: 'data:fresh',
      label: 'No stale data on /daily',
      ok: !staleness.stale,
      detail: staleness.stale
        ? `Snapshot is stale (${staleness.asOfLabel ?? 'no timestamp'}, via ${via}). ${staleness.expectedNote}`
        : `Snapshot fresh, as of ${staleness.asOfLabel ?? 'unknown'} (via ${via}).`,
    });
  } catch (error) {
    const detail = `Failed: ${error instanceof Error ? error.message : String(error)}.`;
    checks.push({ id: 'data:chain', label: 'Chain data source (Polygon/Cboe) responds', ok: false, detail });
    checks.push({ id: 'data:fresh', label: 'No stale data on /daily', ok: false, detail: 'Could not load a snapshot to grade.' });
  }

  // 5b: is a second chain source standing by if the primary goes stale? This is
  // informational, not a failure — a deployment can legitimately run Cboe-only —
  // but during a primary-feed outage it is the first thing to check, so it earns
  // a permanent row rather than a line buried in the stale detail.
  const secondary = config.sourceFallback ? secondaryChainSource() : null;
  checks.push({
    id: 'data:fallback',
    label: 'Failover chain source configured',
    ok: true,
    detail: !config.sourceFallback
      ? `Disabled (GAMMADESK_SOURCE_FALLBACK is off). Primary ${config.dataSource} has no standby.`
      : secondary
        ? `${secondary} is available to cover a stale ${config.dataSource} feed.`
        : `None — primary is ${config.dataSource} and no secondary is usable (Polygon needs POLYGON_API_KEY). A stale primary shows the banner with no failover.`,
  });

  // 6: the compact Cboe quote feed responds.
  try {
    const q = await fetchCboeQuote('SPY');
    checks.push({ id: 'data:quotes', label: 'Cboe quote feed responds', ok: true, detail: `SPY quoted at ${q.price}.` });
  } catch (error) {
    checks.push({ id: 'data:quotes', label: 'Cboe quote feed responds', ok: false, detail: `Failed: ${error instanceof Error ? error.message : String(error)}.` });
  }

  // 7: today's expected X posts were actually sent.
  const posting = postingEnabled();
  const log = await readLog().catch(() => []);
  const posts = evaluateExpectedPosts(
    log.map((e) => ({ slot: e.slot, date: e.date, outcome: e.outcome })),
    date,
    { tradingDay, postingEnabled: posting },
  );
  checks.push({ id: 'posts:sent', label: "Today's expected X posts were sent", ok: posts.ok, detail: posts.detail });

  // 7b: the X poster is not paused. An auto-pause (an X auth/billing error)
  // silences every slot for the rest of the day, so a live-but-paused poster is
  // a failure the nightly email must carry — the same signal the immediate
  // auto-pause alert sends, repeated here so it cannot be missed.
  const pause = await readPause().catch(() => ({ paused: false }) as Awaited<ReturnType<typeof readPause>>);
  checks.push({
    id: 'x:pause',
    label: 'X posting is not paused',
    ok: !pause.paused,
    detail: pause.paused
      ? `PAUSED — ${pause.reason ?? 'no reason recorded'}${pause.at ? ` (since ${pause.at})` : ''}`
      : 'Posting is live (not paused).',
  });

  // 8: today's briefs arrived from Cowork.
  if (!tradingDay) {
    checks.push({ id: 'briefs', label: "Today's Cowork briefs arrived", ok: true, detail: 'Not a trading day — no briefs expected.' });
  } else {
    const [morning, closing] = await Promise.all([
      readBriefForDate(date).catch(() => null),
      readClosingBriefForDate(date).catch(() => null),
    ]);
    const missing: string[] = [];
    if (!morning) missing.push('morning');
    if (!closing) missing.push('closing');
    checks.push({
      id: 'briefs',
      label: "Today's Cowork briefs arrived",
      ok: missing.length === 0,
      detail: missing.length === 0 ? 'Morning and closing briefs both received.' : `Missing briefs: ${missing.join(', ')}.`,
    });
  }

  // 9: the required env vars are present (names only, never values).
  const missing = missingEnv((name) => Boolean(process.env[name]?.trim()));
  checks.push({
    id: 'env:present',
    label: 'Required env vars present (X keys, BRIEF_TOKEN, X_POSTING_ENABLED)',
    ok: missing.length === 0,
    detail: missing.length === 0 ? 'All required variables are set.' : `Missing: ${missing.join(', ')}.`,
  });

  // 10: Vercel Blob is writable.
  checks.push(await checkBlobWritable());

  return toReport(date, now.toISOString(), checks);
}
