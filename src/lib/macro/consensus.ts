/*
 * PROBE RESULT — 2026-09-04. FMP is unusable on the key we have; do not retry
 * without a plan upgrade.
 *
 * Ran `scripts/probe-fmp.mjs` against a real FMP_API_KEY (a valid 32-char key).
 * The economic-calendar endpoint is inaccessible on this subscription, so the
 * cross-check cannot see a single row — the future-vs-past consensus question is
 * moot because nothing comes back at all:
 *
 *   - /stable/economic-calendar          -> HTTP 402 "Restricted Endpoint: not
 *                                            available under your current
 *                                            subscription"
 *   - /api/v3/economic_calendar (legacy) -> HTTP 403 "Legacy Endpoint" — FMP
 *                                            retired it on 2025-08-31 for all
 *                                            but pre-cutoff subscribers.
 *
 * Verdict: SKIP FMP. The path below stays dark — `GAMMADESK_MACRO_FMP` unset —
 * and the feature is built on the hand-maintained file alone. Re-run the probe
 * only after the FMP plan is upgraded to one that includes the economic
 * calendar; there is no point retrying on the same subscription.
 */

import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cached } from '../cache';
import type { EconEvent, SurpriseDirection } from './translate';

/**
 * Where the translator's consensus numbers come from.
 *
 * ## The hand-maintained file is the source of truth
 *
 * `data/econ-consensus.json` (at the project root) is authored by hand and wins
 * every conflict. It is a small, checked-in list of the high-impact US releases,
 * each carrying the expected figure, the prior print, and — crucially — which
 * way a higher number pushes conditions. That last field is the whole feature:
 * it cannot be scraped reliably and it is what turns a raw surprise into
 * "tightening" or "easing".
 *
 * ## Read at runtime, not baked into the bundle
 *
 * The file is read from disk on demand (behind a short cache), not imported as a
 * module. A static `import … from '…json'` inlines the JSON at build time, so a
 * new number would not appear until the next rebuild. Reading it at runtime
 * means an edit is picked up on the next request — within `RELOAD_SECONDS` — with
 * no rebuild. The one place that does not help is a read-only production host
 * (Vercel), where the deployed filesystem is baked from the repo at build: there
 * a committed edit still needs a redeploy. `next.config.mjs` lists this file in
 * `outputFileTracingIncludes` so it is actually shipped into the server bundle
 * rather than tree-shaken away.
 *
 * ## Placeholders are skipped, not errors
 *
 * Rows are added ahead of time with `consensus` and `releaseAt` left null, to be
 * filled in as each release approaches. Such a row is silently skipped, not
 * warned about — it is a deliberate placeholder, not bad data. A row that is
 * malformed in a way that is *not* a placeholder (an unknown `direction`, a
 * non-numeric consensus that is present but wrong) is still dropped with a
 * warning. The per-row `note` fields are maintenance reminders and are stripped
 * on parse; nothing downstream ever sees them.
 *
 * ## FMP is a cross-check, not a display source
 *
 * The economic-calendar endpoint at Financial Modeling Prep can enrich this,
 * but two things hold it at arm's length. First, a **display-licensing question
 * is unresolved**, so no FMP-sourced value may be shown publicly — while the
 * feature flag is off (its default) this whole feature is local-only anyway,
 * and even on, the FMP path here only ever *compares and logs*, it does not feed
 * a rendered number. Second, and the reason the merge is one-directional: the
 * hand file always wins, so the only useful thing FMP can do is disagree loudly
 * enough that a stale hand-maintained figure gets noticed and corrected.
 *
 * ## The probe that gates the FMP path
 *
 * FMP's calendar must actually populate the estimate field for *future-dated*
 * events for the cross-check to be worth anything — a calendar that only fills
 * in the estimate after the release cannot warn us about a wrong consensus
 * before the print. `scripts/probe-fmp.mjs` runs one request over the next
 * fourteen days and reports whether the estimate field is populated ahead of
 * time. Until that probe has been run against a real key and passed, keep
 * `GAMMADESK_MACRO_FMP` unset: `crossCheckConsensus` is a no-op without both the
 * key and that flag, so the default build never calls FMP at all.
 */

interface RawEvent {
  event?: unknown;
  releaseAt?: unknown;
  consensus?: unknown;
  previous?: unknown;
  actual?: unknown;
  unit?: unknown;
  direction?: unknown;
  inLineTolerance?: unknown;
  /** A maintenance reminder in the file. Read by a human, never by the app. */
  note?: unknown;
}

function isDirection(value: unknown): value is SurpriseDirection {
  return value === 'higher_is_tightening' || value === 'higher_is_easing';
}

/**
 * Parse and validate the checked-in file.
 *
 * Three outcomes per row. A **placeholder** — `consensus` or `releaseAt` still
 * null — is skipped silently: it is a slot the author will fill as the release
 * approaches, not bad data. A **malformed** row (unknown `direction`, a present
 * but non-numeric consensus, an unparseable date) is dropped with a warning, the
 * same posture the rest of the site takes toward data it cannot trust — an
 * unknown direction especially, because without it there is no way to say which
 * way the print leans and guessing is the one thing this feature must never do.
 * Everything else is kept, with its `note` stripped off.
 */
export function parseConsensusFile(raw: unknown): EconEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: EconEvent[] = [];

  for (const row of raw as RawEvent[]) {
    if (!row || typeof row.event !== 'string' || !isDirection(row.direction)) {
      console.warn(`[macro] dropping malformed consensus row: ${JSON.stringify(row)}`);
      continue;
    }

    // Placeholders waiting to be filled in — not yet usable, not an error.
    if (
      row.consensus === null ||
      row.consensus === undefined ||
      row.releaseAt === null ||
      row.releaseAt === undefined
    ) {
      continue;
    }

    if (
      typeof row.consensus !== 'number' ||
      typeof row.releaseAt !== 'string' ||
      typeof row.unit !== 'string' ||
      Number.isNaN(Date.parse(row.releaseAt))
    ) {
      console.warn(`[macro] dropping malformed consensus row: ${JSON.stringify(row)}`);
      continue;
    }

    out.push({
      event: row.event,
      releaseAt: row.releaseAt,
      consensus: row.consensus,
      previous: typeof row.previous === 'number' ? row.previous : null,
      actual: typeof row.actual === 'number' ? row.actual : null,
      unit: row.unit,
      direction: row.direction,
      inLineTolerance:
        typeof row.inLineTolerance === 'number' ? row.inLineTolerance : undefined,
    });
  }

  return out;
}

/**
 * Where the file lives, resolved from the project root at runtime.
 *
 * `process.cwd()` is the project root under `next dev`, `next start`, and a
 * Vercel serverless function alike.
 */
const CONSENSUS_PATH = path.join(process.cwd(), 'data', 'econ-consensus.json');

/**
 * How long a read of the file is reused.
 *
 * Short, because the whole point of reading at runtime is that a freshly-filled
 * number shows up without a rebuild — a long cache would put that behind a wait.
 * Long enough that a burst of page views is one disk read, not one each.
 */
const RELOAD_SECONDS = 30;

/**
 * Every usable hand-maintained release, release-time order, oldest first.
 *
 * Async because the file is read from disk. A read failure degrades to an empty
 * list — the card simply shows nothing rather than taking the page down — with
 * one warning so a genuinely missing or unreadable file is not silent.
 */
export function getConsensusEvents(): Promise<EconEvent[]> {
  return cached('macro:consensus-file', RELOAD_SECONDS, async () => {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(CONSENSUS_PATH, 'utf8'));
    } catch (e) {
      console.warn(`[macro] could not read ${CONSENSUS_PATH}: ${(e as Error).message}`);
      return [];
    }
    return parseConsensusFile(raw).sort(
      (a, b) => Date.parse(a.releaseAt) - Date.parse(b.releaseAt),
    );
  });
}

/**
 * The most recent released high-impact event, and the next one scheduled.
 *
 * "Released" is `actual !== null` and `releaseAt` in the past — a number that
 * has printed. "Next" is the earliest event still ahead of `now`. Either can be
 * null: early on release day nothing has printed yet, and eventually the file's
 * tail runs out and there is no next event until it is topped up.
 */
export interface MacroSelection {
  mostRecent: EconEvent | null;
  next: EconEvent | null;
}

export function selectReleases(
  events: EconEvent[],
  now: Date = new Date(),
): MacroSelection {
  const nowMs = now.getTime();

  let mostRecent: EconEvent | null = null;
  let next: EconEvent | null = null;

  for (const event of events) {
    const at = Date.parse(event.releaseAt);
    if (event.actual !== null && at <= nowMs) {
      // Events are release-ordered, so the last one that qualifies is the newest.
      mostRecent = event;
    }
    if (at > nowMs && next === null) {
      next = event;
    }
  }

  return { mostRecent, next };
}

export async function getMacroSelection(
  now: Date = new Date(),
): Promise<MacroSelection> {
  return selectReleases(await getConsensusEvents(), now);
}

// --- FMP cross-check (gated, never displayed) ------------------------------

/**
 * The largest consensus gap, in the event's unit, that counts as agreement.
 *
 * Below this FMP and the hand file are treated as saying the same thing —
 * calendars round and revise, and a hundredth-of-a-point difference is not a
 * disagreement worth a warning. This is not a display threshold; nothing here
 * reaches the screen.
 */
const CONSENSUS_TRIVIAL = 0.05;

interface FmpCalendarRow {
  event?: string;
  date?: string;
  country?: string;
  impact?: string;
  estimate?: number | null;
}

/**
 * Whether the FMP cross-check is even allowed to run.
 *
 * Both a key and the explicit `GAMMADESK_MACRO_FMP` flag are required, and the
 * flag exists so the path stays dark until the probe has confirmed FMP
 * populates future estimates and the display-licensing question is settled.
 * With either missing this returns false and no FMP request is ever made.
 */
export function fmpCrossCheckEnabled(): boolean {
  const flag = process.env.GAMMADESK_MACRO_FMP?.trim().toLowerCase();
  return Boolean(process.env.FMP_API_KEY?.trim()) && (flag === '1' || flag === 'true');
}

/**
 * Compare the hand file against FMP's US high-impact calendar and log any
 * consensus disagreement. Returns the number of disagreements found, or null
 * when the path is disabled or the request failed — a failure here must never
 * touch the page.
 *
 * Cached for an hour: the calendar changes on the scale of days, and this is a
 * background integrity check, not something a page view may trigger.
 */
export async function crossCheckConsensus(
  now: Date = new Date(),
): Promise<number | null> {
  if (!fmpCrossCheckEnabled()) return null;

  return cached('macro:fmp-crosscheck', 3600, async () => {
    try {
      const from = now.toISOString().slice(0, 10);
      const to = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
      // The `/stable` endpoint. The legacy `/api/v3/economic_calendar` was
      // retired on 2025-08-31 and answers 403 for non-legacy keys — see the
      // probe result at the top of this file.
      const url =
        'https://financialmodelingprep.com/stable/economic-calendar' +
        `?from=${from}&to=${to}&apikey=${encodeURIComponent(process.env.FMP_API_KEY!)}`;

      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return null;

      const rows = (await response.json()) as FmpCalendarRow[];
      const us = rows.filter(
        (r) => r.country === 'US' && (r.impact ?? '').toLowerCase() === 'high',
      );

      const byName = new Map(us.map((r) => [(r.event ?? '').toLowerCase(), r]));
      let disagreements = 0;

      for (const local of await getConsensusEvents()) {
        const match = byName.get(local.event.toLowerCase());
        if (!match || typeof match.estimate !== 'number') continue;
        if (Math.abs(match.estimate - local.consensus) > CONSENSUS_TRIVIAL) {
          disagreements += 1;
          console.warn(
            `[macro] consensus disagreement on "${local.event}": local ${local.consensus}${local.unit} vs FMP ${match.estimate}${local.unit}. Hand file wins; check whether it is stale.`,
          );
        }
      }

      return disagreements;
    } catch {
      // A background integrity check that throws must fail silently.
      return null;
    }
  });
}
