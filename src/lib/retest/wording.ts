/**
 * The words each event is printed in.
 *
 * Kept apart from the state machine so the wording can be rewritten without
 * touching the logic, and so the logic cannot change what a line claims.
 *
 * ## Both directions get equal billing
 *
 * The machine treats a level lost downwards and a level taken upwards as one
 * mirrored case. The wording has to match that, or the feature quietly becomes
 * a bearish one:
 *
 *   down   lost      REJECTED    the level pushed price back away
 *   up     taken     HELD        the breakout was not pushed back
 *
 * Same event, same confidence, opposite direction. There is no wording here
 * that exists on one side only.
 */

import type { RetestEvent } from './types';

/** What the break itself is called. */
export function breakWord(direction: RetestEvent['direction']): string {
  return direction === 'down' ? 'lost' : 'taken';
}

/** The capitalised outcome word, which is what the eye lands on. */
export function outcomeWord(event: RetestEvent): string {
  if (event.outcome === 'fake-break') return 'FAKE BREAK';
  if (event.outcome === 'broke-and-left') return 'BROKE AND LEFT';
  return event.direction === 'down' ? 'REJECTED' : 'HELD';
}

/** `above-average volume` / `below-average volume`. */
export function volumeWord(event: RetestEvent): string {
  return event.volumeAboveAverage ? 'above-average volume' : 'below-average volume';
}

/**
 * A level price as it is written in a line.
 *
 * Trailing zeros dropped, so a strike reads as 770 rather than 770.00 while a
 * solved flip keeps the decimals it actually has. The full precision is what
 * was pinned; this only decides how it is spelled.
 */
export function priceWords(price: number): string {
  return price.toFixed(2).replace(/\.?0+$/, '');
}

export function levelWords(event: RetestEvent): string {
  // The label never embeds the price — it is composed here, once, so no line
  // can end up reading "770.00 770 wall".
  return `${priceWords(event.levelPrice)} ${event.label}`;
}

/** New York clock of an ISO timestamp, `H:MM`, as the feed prints times. */
function clock(iso: string | null): string | null {
  if (!iso) return null;
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  /*
   * `hour: 'numeric'` with `hour12: false` still pads to "09" in en-US, which
   * is a long-standing quirk rather than something the options above can fix.
   * The feed reads 9:52, the way a person says it.
   */
  return formatted.replace(/^0/, '');
}

/**
 * The New York clock an event fired at, spelled the way the lines spell it.
 *
 * The stored `etClock` is zero-padded, and a row showing "09:36" beside a
 * sentence saying "9:36" is the same time written two ways in one paragraph.
 * Everything on screen goes through here.
 */
export function firedClock(event: RetestEvent): string {
  return clock(event.firedAt) ?? event.etClock.replace(/^0/, '');
}

/**
 * The compact one-line form, as the brief specifies it:
 *
 *   770 lost 9:52 · retested 9:58 · REJECTED on above-average volume · breadth 34%
 */
export function eventLine(event: RetestEvent): string {
  const parts: string[] = [
    `${levelWords(event)} ${breakWord(event.direction)} ${clock(event.brokenAt)}`,
  ];

  const retested = clock(event.retestedAt);
  if (retested) parts.push(`retested ${retested}`);

  parts.push(`${outcomeWord(event)} on ${volumeWord(event)}`);

  if (event.breadthPct !== null) {
    parts.push(`breadth ${Math.round(event.breadthPct)}%`);
  }

  return parts.join(' · ');
}

/**
 * The same event as a sentence, for a reader who has never heard "retest".
 *
 * Shown under the compact line rather than instead of it: the short form is
 * what someone scanning the feed reads, the sentence is what someone meeting
 * it for the first time reads.
 */
export function eventSentence(event: RetestEvent): string {
  // The same spelling as the compact line above it, so one row does not print
  // 774.2 and 774.20 in consecutive sentences.
  const level = priceWords(event.levelPrice);
  const through = event.direction === 'down' ? 'below' : 'above';
  const back = event.direction === 'down' ? 'back up' : 'back down';

  if (event.outcome === 'fake-break') {
    return `Price closed ${through} ${level}, then closed straight ${back} again. The break did not stick.`;
  }

  if (event.outcome === 'broke-and-left') {
    return `Price closed ${through} ${level} and kept going. It never came back to test the level.`;
  }

  if (event.direction === 'down') {
    return `Price closed below ${level}, came back up to check it, and was pushed away.`;
  }
  return `Price closed above ${level}, came back down to check it, and was not pushed back.`;
}

/**
 * The regime-flip line.
 *
 * Says what changed about conditions and stops. It does not say what to do,
 * and it does not say what price will do next.
 */
export function regimeSentence(event: RetestEvent): string | null {
  if (event.regime === null) return null;
  const at = clock(event.firedAt);

  if (event.regime === 'calm') {
    return `${priceWords(event.levelPrice)} reclaimed and held ${at} — dealers now dampen moves instead of amplifying them. Walls start acting like walls again.`;
  }
  return `${priceWords(event.levelPrice)} lost and rejected ${at} — dealers now amplify moves instead of dampening them. Walls hold less well below this line.`;
}

/** Which tooltip explains this outcome. */
export function outcomeTip(event: RetestEvent): 'retestFailed' | 'retestFake' | 'retestLeft' {
  if (event.outcome === 'fake-break') return 'retestFake';
  if (event.outcome === 'broke-and-left') return 'retestLeft';
  return 'retestFailed';
}
