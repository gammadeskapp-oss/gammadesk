import 'server-only';

import { getPositioning } from '../positioning';
import { formatClockEt, marketToday } from '../time';
import { fetchCboeQuote, fetchCboeQuotes } from './cboeQuote';
import { readBriefForDate, readClosingBriefForDate } from './brief';
import { formatClockCt } from './schedule';
import {
  composeBriefMorning,
  composeClosing,
  composeClosingBrief,
  composeFallbackMorning,
  composeGamma,
  composePulse,
  type ComposedPost,
} from './text';
import type { PostSlotKind } from './types';

/**
 * The data-fetching side of composition: pull the dealer-positioning book and
 * the Cboe quotes, then hand the primitives to the pure composers in `text.ts`.
 *
 * The plain-English translation of the levels (balance point / ceiling / floor
 * / calm-choppy) and every wording rule live in `text.ts`, where they are
 * unit-tested; this file only decides which numbers go in.
 */

export { X_LIMIT, DISCLAIMER } from './text';
export type { ComposedPost } from './text';

export const PULSE_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'VIX'] as const;

/**
 * The 8:25 CT morning post now leads with the Cowork "Morning Desk" brief.
 *
 * If today's brief has arrived it drives the post (SPY/QQQ/VIX, top story,
 * earnings). If not, it falls back to a simple live SPY/QQQ/VIX snapshot and
 * carries a "brief missing" note so the log records the miss. Either way the
 * post is stamped in Central time, carries no gamma levels and no link — those
 * belong to the 8:30 post.
 */
export async function buildMorning(now: Date = new Date()): Promise<ComposedPost> {
  const asOf = formatClockCt(now);
  const brief = await readBriefForDate(marketToday(now)).catch(() => null);
  if (brief) {
    return composeBriefMorning(brief, asOf);
  }

  // Fallback: a plain SPY/QQQ/VIX snapshot from live Cboe quotes.
  const quotes = await fetchCboeQuotes(['SPY', 'QQQ', 'VIX']);
  const spy = quotes.get('SPY');
  const qqq = quotes.get('QQQ');
  const vix = quotes.get('VIX');
  const isos = [spy, qqq, vix].filter(Boolean).map((q) => q!.quoteIso).sort();
  const dataIso = isos.slice(-1)[0] ?? now.toISOString();
  return composeFallbackMorning(
    {
      spy: spy && { price: spy.price, changePct: spy.changePct, quoteIso: spy.quoteIso },
      qqq: qqq && { price: qqq.price, changePct: qqq.changePct, quoteIso: qqq.quoteIso },
      vix: vix && { price: vix.price, changePct: vix.changePct, quoteIso: vix.quoteIso },
    },
    asOf,
    dataIso,
  );
}

export async function buildGamma(): Promise<ComposedPost> {
  const data = await getPositioning();
  const s = data.summary;
  return composeGamma({
    spot: s.spot,
    regime: s.regime,
    flipLevel: s.flipLevel,
    wallAbove: s.magnetAbove?.strike ?? null,
    floorBelow: s.magnetBelow?.strike ?? null,
    asOfLabel: formatClockEt(new Date(data.meta.quoteDateIso)),
    dataIso: data.meta.quoteDateIso,
  });
}

export async function buildPulse(): Promise<ComposedPost> {
  const quotes = await fetchCboeQuotes([...PULSE_SYMBOLS]);
  const spy = quotes.get('SPY');
  const qqq = quotes.get('QQQ');
  const iwm = quotes.get('IWM');
  const vix = quotes.get('VIX');

  // The freshest of the symbol timestamps is what the post is "as of".
  const isos = [spy, qqq, iwm, vix]
    .filter(Boolean)
    .map((q) => q!.quoteIso)
    .sort();
  const dataIso = isos.slice(-1)[0] ?? new Date().toISOString();

  return composePulse(
    {
      spy: spy && { price: spy.price, changePct: spy.changePct, quoteIso: spy.quoteIso },
      qqq: qqq && { price: qqq.price, changePct: qqq.changePct, quoteIso: qqq.quoteIso },
      iwm: iwm && { price: iwm.price, changePct: iwm.changePct, quoteIso: iwm.quoteIso },
      vix: vix && { price: vix.price, changePct: vix.changePct, quoteIso: vix.quoteIso },
    },
    formatClockEt(new Date(dataIso)),
    dataIso,
  );
}

/**
 * The 3:20 CT closing post now leads with the Cowork "Closing Bell" brief.
 *
 * If today's closing brief has arrived it drives the post (index changes, VIX,
 * what drove the day, top movers). If not, it falls back to the original
 * dealer-positioning closing post and carries a "closing brief missing" note.
 * No link either way.
 */
export async function buildClosing(now: Date = new Date()): Promise<ComposedPost> {
  const brief = await readClosingBriefForDate(marketToday(now)).catch(() => null);
  if (brief) {
    return composeClosingBrief(brief);
  }

  const data = await getPositioning();
  const s = data.summary;

  // Day change from Cboe's compact SPY quote; levels from the book. If the
  // quote fails, the post still goes out without the percentage.
  let spyChangePct: number | null = null;
  let spyPrice: number | null = null;
  let quoteIso: string | null = null;
  try {
    const q = await fetchCboeQuote('SPY');
    spyChangePct = q.changePct;
    spyPrice = q.price;
    quoteIso = q.quoteIso;
  } catch {
    // Levels-only closing post.
  }

  const dataIso = quoteIso ?? data.meta.quoteDateIso;
  const composed = composeClosing({
    spot: s.spot,
    regime: s.regime,
    flipLevel: s.flipLevel,
    wallAbove: s.magnetAbove?.strike ?? null,
    floorBelow: s.magnetBelow?.strike ?? null,
    asOfLabel: formatClockEt(new Date(dataIso)),
    dataIso,
    spyChangePct,
    spyPrice,
  });
  return { ...composed, note: 'closing brief missing' };
}

export function buildForSlot(slot: PostSlotKind, now: Date = new Date()): Promise<ComposedPost> {
  switch (slot) {
    case 'morning':
      return buildMorning(now);
    case 'gamma':
      return buildGamma();
    case 'pulse':
      return buildPulse();
    case 'closing':
      return buildClosing(now);
  }
}
