import 'server-only';

import { getPositioning } from '../positioning';
import { formatClockEt } from '../time';
import { fetchCboeQuote, fetchCboeQuotes } from './cboeQuote';
import {
  composeClosing,
  composeGamma,
  composeMorning,
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

export async function buildMorning(): Promise<ComposedPost> {
  const data = await getPositioning();
  const s = data.summary;
  return composeMorning({
    spot: s.spot,
    regime: s.regime,
    flipLevel: s.flipLevel,
    wallAbove: s.magnetAbove?.strike ?? null,
    floorBelow: s.magnetBelow?.strike ?? null,
    asOfLabel: formatClockEt(new Date(data.meta.quoteDateIso)),
    dataIso: data.meta.quoteDateIso,
  });
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

export async function buildClosing(): Promise<ComposedPost> {
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
  return composeClosing({
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
}

export function buildForSlot(slot: PostSlotKind): Promise<ComposedPost> {
  switch (slot) {
    case 'morning':
      return buildMorning();
    case 'gamma':
      return buildGamma();
    case 'pulse':
      return buildPulse();
    case 'closing':
      return buildClosing();
  }
}
