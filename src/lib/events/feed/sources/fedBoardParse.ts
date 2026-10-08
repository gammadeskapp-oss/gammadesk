/**
 * The Fed Board calendar parser — pure, so `verify:fed-events` can drive it
 * with a fixture (see the split rationale in `../types.ts`).
 *
 * ## What it reads
 *
 * The monthly calendar at `federalreserve.gov/newsevents/{YYYY}-{month}.htm`.
 * Rather than key on a class name (the Board re-skins the site periodically and
 * a class is the first thing to change), it keys on the one semantic anchor the
 * page reliably carries: a `<time datetime="…">` element per event. Each event
 * is that `<time>` plus the markup up to the next one, from which the title and
 * speaker are pulled.
 *
 * ## Honest caveat
 *
 * The exact live markup cannot be fetched from this build's sandbox, so the
 * extraction is written defensively and unit-tested against a fixture shaped
 * like the documented structure — it is NOT proof it matches today's live HTML.
 * The first production run is the real test: a selector that has drifted yields
 * zero Fed events, which the refresh records as a source failure and the admin
 * health view surfaces, while the last good fetch is kept (see `../store.ts`).
 */

import { buildFetchedEvent, fedBoardImportance, type FetchedEvent } from '../types';

/** Strip HTML tags and collapse whitespace to a single clean line. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `YYYY-MM-DD` out of a `datetime` attribute, or null. */
function parseDate(datetime: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(datetime);
  return m ? m[1] : null;
}

/**
 * A 24-hour `HH:MM` out of a `datetime` attribute, or failing that, out of a
 * display string like "2:00 p.m." Returns null when neither carries a time —
 * an all-day entry (a meeting day) has no clock to invent.
 */
export function parseTimeEt(datetime: string, display: string): string | null {
  const iso = /\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(datetime);
  if (iso) return iso[1];

  const m = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(display);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  const minute = m[2] ?? '00';
  if (/p/i.test(m[3])) hour += 12;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

/** The first heading-ish block's text in a chunk, or its leading stripped text. */
function extractTitle(chunk: string): string {
  const block = /<(p|h[1-6]|strong|a)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(chunk);
  const text = stripTags(block ? block[2] : chunk);
  // Keep it to the headline; a trailing description after a period is dropped.
  return text.split(/(?<=\.)\s/)[0].slice(0, 140).trim();
}

/** A "Chair Powell" / "Governor Waller" style attribution from a title, or ''. */
export function extractWho(title: string): string {
  const m =
    /\b(Vice Chair for Supervision|Vice Chair|Chair|Governor)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/.exec(
      title,
    );
  return m ? `${m[1]} ${m[2]}` : '';
}

/**
 * Parse a month's Fed Board calendar HTML into fetched events. Entries without
 * a usable date or time are dropped rather than guessed; the caller filters to
 * the window it wants.
 */
export function parseFedBoardCalendar(
  html: string,
  opts: { sourceUrl: string },
): FetchedEvent[] {
  const events: FetchedEvent[] = [];
  const re =
    /<time[^>]*\bdatetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>([\s\S]*?)(?=<time[^>]*\bdatetime=|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const [, datetime, timeDisplay, rest] = match;
    const date = parseDate(datetime);
    if (!date) continue;

    const timeEt = parseTimeEt(datetime, stripTags(timeDisplay));
    if (!timeEt) continue; // all-day / untimed — nothing to put on a clock

    const title = extractTitle(rest);
    if (!title) continue;

    const who = extractWho(title);
    events.push(
      buildFetchedEvent({
        date,
        timeEt,
        name: title,
        importance: fedBoardImportance(title, { who }),
        source: 'fed-board',
        sourceUrl: opts.sourceUrl,
        ...(who ? { who } : {}),
      }),
    );
  }

  return events;
}
