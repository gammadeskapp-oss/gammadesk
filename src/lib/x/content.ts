import 'server-only';

import { formatClockEt, marketToday } from '../time';
import { readBriefForDate, readWeeklyBriefForWeek } from './brief';
import { mostRecentFriday } from './schedule';
import {
  composeEarningsPost,
  composeWeeklyBrief,
  selectEarningsNames,
} from './text';
import {
  composeClosing,
  composeIntradayFallback,
  composeMorning,
  type Composed,
  type DeskSnapshot,
} from './compose';
import { composeIntradayPhrase } from './phrases';
import { loadDeskSnapshot } from './deskData';
import type { PostNumbers, PostSlotKind } from './types';

/**
 * The composition side of the poster: turn a slot into finished text.
 *
 * The three market slots (morning, intraday, closing) are built from one
 * `DeskSnapshot` — the same figures /decision shows for SPY. Morning and closing
 * are fixed templates; intraday picks a line from the free phrase bank
 * (`phrases.ts`) for the current situation, and falls back to a fixed line if no
 * phrase can be rendered. Weekly and earnings are the editorial recaps, still
 * driven by the Cowork briefs.
 *
 * Everything here returns a single normalised `BuiltPost` so `run.ts` can
 * deliver any slot the same way.
 */

export interface BuildContext {
  /** A pre-loaded snapshot, so a route that already fetched one avoids a second fetch. */
  snapshot?: DeskSnapshot;
  /** Intraday phrase ids already posted today — never reused while alternatives exist. */
  usedPhrases?: string[];
  /** Intraday phrase id → uses over the last ~5 days, for the self-varying selector. */
  phraseUsage?: Record<string, number>;
  /** False suppresses "wild/bigger moves" intraday wording (throttled to 1/hour). */
  allowWild?: boolean;
}

export interface BuiltPost {
  text: string;
  length: number;
  numbers: PostNumbers;
  dataIso: string;
  /**
   * Weekly and earnings are editorial recaps: no "as of" freshness clock, and
   * graded by the older wording rules rather than the market-slot self-checks.
   */
  editorial: boolean;
  /** Editorial "as of" label, for the log. */
  asOfLabel?: string;
  /** A stored poster image to try to attach (editorial slots only now). */
  image?: { date: string; type: 'weekly' | 'earnings' };
  /** An operational note folded into a successful post's log line. */
  note?: string;
  /** For an intraday post: which situation the phrase bank matched. */
  situation?: string;
  /** For an intraday post: the phrase id used, recorded for self-varying. */
  phraseId?: string;
  /** For an intraday post: true when it used "wild/bigger moves" wording. */
  wild?: boolean;
}

function fromComposed(c: Composed, note?: string): BuiltPost {
  return { text: c.text, length: c.length, numbers: c.numbers, dataIso: c.dataIso, editorial: false, note };
}

async function buildMorning(ctx: BuildContext, now: Date): Promise<BuiltPost> {
  const snapshot = ctx.snapshot ?? (await loadDeskSnapshot(now));
  return fromComposed(composeMorning(snapshot));
}

async function buildClosing(ctx: BuildContext, now: Date): Promise<BuiltPost> {
  const snapshot = ctx.snapshot ?? (await loadDeskSnapshot(now));
  return fromComposed(composeClosing(snapshot));
}

/**
 * The intraday update. Picks a line from the free phrase bank for the current
 * situation (below flip, near a level, broke out, in range), never a phrase
 * already used today, preferring the least-used over recent days. Falls back to
 * the fixed line only when no phrase can be rendered from this snapshot.
 */
async function buildIntraday(ctx: BuildContext, now: Date): Promise<BuiltPost> {
  const snapshot = ctx.snapshot ?? (await loadDeskSnapshot(now));
  const picked = composeIntradayPhrase(snapshot, {
    used: ctx.usedPhrases ?? [],
    usage: ctx.phraseUsage ?? {},
    allowWild: ctx.allowWild ?? true,
  });
  if (picked) {
    return {
      ...fromComposed(picked.composed, `phrase: ${picked.situation}`),
      situation: picked.situation,
      phraseId: picked.phraseId,
      wild: picked.wild,
    };
  }
  return fromComposed(composeIntradayFallback(snapshot), 'no renderable phrase, used fallback');
}

/**
 * The Sunday weekly recap, from the Cowork "Week in review" brief. No live
 * fallback: a missing brief throws and the runner logs a skip.
 */
async function buildWeekly(now: Date): Promise<BuiltPost> {
  const weekEnding = mostRecentFriday(now);
  const brief = await readWeeklyBriefForWeek(weekEnding).catch(() => null);
  if (!brief) throw new Error(`No weekly brief for the week ending ${weekEnding} has arrived.`);
  const c = composeWeeklyBrief(brief);
  return {
    text: c.text,
    length: c.length,
    numbers: c.numbers,
    dataIso: c.dataIso,
    editorial: true,
    asOfLabel: c.asOfLabel,
    image: c.image ? { date: c.image.date, type: 'weekly' } : undefined,
  };
}

/**
 * The 7:30 CT earnings-day heads-up, from the morning brief's earnings list
 * filtered to well-known large companies. Throws (→ silent skip) when there is
 * no brief yet, or nobody the broad market cares about reports.
 */
async function buildEarnings(now: Date): Promise<BuiltPost> {
  const date = marketToday(now);
  const brief = await readBriefForDate(date).catch(() => null);
  if (!brief) throw new Error('No morning brief yet, so no earnings names to post.');
  const picks = selectEarningsNames(brief.earningsToday, 3);
  if (picks.length === 0) throw new Error('No well-known large company reports today.');
  const c = composeEarningsPost(
    picks.map((p) => p.display),
    formatClockEt(new Date(brief.receivedAt ?? now.toISOString())),
    brief.receivedAt ?? now.toISOString(),
    { date, type: 'earnings' },
  );
  return {
    text: c.text,
    length: c.length,
    numbers: c.numbers,
    dataIso: c.dataIso,
    editorial: true,
    asOfLabel: c.asOfLabel,
    image: { date, type: 'earnings' },
  };
}

export function buildForSlot(
  slot: PostSlotKind,
  now: Date = new Date(),
  ctx: BuildContext = {},
): Promise<BuiltPost> {
  switch (slot) {
    case 'morning':
      return buildMorning(ctx, now);
    case 'intraday':
      return buildIntraday(ctx, now);
    case 'closing':
      return buildClosing(ctx, now);
    case 'weekly':
      return buildWeekly(now);
    case 'earnings':
      return buildEarnings(now);
  }
}
