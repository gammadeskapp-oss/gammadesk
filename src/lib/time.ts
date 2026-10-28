/**
 * Market-clock helpers. Everything options-related happens on New York time,
 * and the UTC offset changes twice a year, so we resolve it with the IANA
 * database via Intl rather than hard-coding -4 or -5.
 */

export const MARKET_TZ = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset, in milliseconds, of New York time from UTC at the given instant. */
function tzOffsetMs(utcMs: number): number {
  const parts = partsFormatter.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * Convert a New York wall-clock time to a UTC epoch. Run twice so that a
 * timestamp landing near a DST boundary settles on the correct offset.
 */
export function marketTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utc = naive - tzOffsetMs(naive);
  utc = naive - tzOffsetMs(utc);
  return utc;
}

/** Today's date in New York, as `YYYY-MM-DD`. */
export function marketToday(now: Date = new Date()): string {
  const parts = partsFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Current New York wall-clock, broken out for market-hours decisions. */
export function marketNow(now: Date = new Date()): {
  date: string;
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts = partsFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [y, m, d] = date.split('-').map(Number);

  return {
    date,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), // 0 = Sunday
  };
}

/** Add calendar days to a `YYYY-MM-DD` string, returning the same format. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Time to expiry in years for a `YYYY-MM-DD` expiration date.
 * Listed SPY options stop trading at 16:00 New York time on the expiry date.
 * Returns a negative number for expirations already in the past.
 */
export function yearsToExpiry(expiration: string, now: Date = new Date()): number {
  const [y, m, d] = expiration.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const expiryMs = marketTimeToUtcMs(y, m, d, 16, 0);
  return (expiryMs - now.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

/*
 * ## Expired contracts — the one rule
 *
 * A contract is live until 16:00 New York on its expiration date and expired
 * from that instant on. So anything expiring before today's New York date is
 * gone, a same-day (0DTE) contract stays through the session, and it drops at
 * the close — after which the next expiration leads. Every options read in the
 * app filters through `isExpired` / `dropExpired`; nothing compares expiration
 * strings against a date of its own.
 *
 * Stored payloads (positioning, decision, forecast) were built from whatever
 * was live when they were built. `closedSince` says whether a close has passed
 * since then — i.e. whether one of their expirations may have expired under
 * them — so a reader rebuilds instead of serving a level computed from a dead
 * contract. Half-day sessions are treated as a 16:00 close, which keeps a
 * 0DTE contract on screen until 16:00 rather than its 13:00 early close.
 */

/** Epoch ms of 16:00 New York on `expiration` — the instant it stops trading. */
export function expiryCloseMs(expiration: string): number {
  const [y, m, d] = expiration.split('-').map(Number);
  if (!y || !m || !d) return Number.NEGATIVE_INFINITY;
  return marketTimeToUtcMs(y, m, d, 16, 0);
}

/** True once `expiration`'s 16:00 ET close has passed. A malformed date counts as expired. */
export function isExpired(expiration: string, now: Date = new Date()): boolean {
  return now.getTime() >= expiryCloseMs(expiration);
}

/** `items` without any whose `expiration` has passed. */
export function dropExpired<T extends { expiration: string }>(items: readonly T[], now: Date = new Date()): T[] {
  return items.filter((item) => !isExpired(item.expiration, now));
}

/** Epoch ms of the first weekday 16:00 ET close strictly after `now`. */
export function nextCloseMs(now: Date = new Date()): number {
  let date = marketToday(now);
  for (let i = 0; i < 8; i += 1) {
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const close = marketTimeToUtcMs(y, m, d, 16, 0);
    if (weekday !== 0 && weekday !== 6 && close > now.getTime()) return close;
    date = addDays(date, 1);
  }
  return Number.POSITIVE_INFINITY;
}

/** True when a weekday 16:00 ET close fell after `builtAt` and at or before `now`. */
export function closedSince(builtAt: Date | string, now: Date = new Date()): boolean {
  const built = typeof builtAt === 'string' ? new Date(builtAt) : builtAt;
  if (!Number.isFinite(built.getTime())) return true;
  return nextCloseMs(built) <= now.getTime();
}

/** Whole days to expiry, for column labels like "3d". */
export function daysToExpiry(expiration: string, now: Date = new Date()): number {
  return Math.max(0, Math.round(yearsToExpiry(expiration, now) * 365));
}

/** `2026-08-06` -> `AUG 06`, used for the compact table column headers. */
export function formatExpiryLabel(expiration: string): string {
  const [, m, d] = expiration.split('-');
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return expiration;
  return `${months[idx]} ${d}`;
}

/**
 * Human-readable "data as of" stamp, always rendered on the server so the
 * client can't produce a different string and trip a hydration mismatch.
 */
export function formatAsOf(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(date)} ET`;
}

/**
 * Just the wall clock, e.g. `09:30 ET`.
 *
 * `formatAsOf` above carries the date too, which is what a provenance stamp
 * needs. A sentence that has already named the day — "updates again Monday 31
 * Aug at 09:30 ET" — would repeat itself using that one, so this is the
 * shorter sibling rather than a second way to write the same string.
 */
export function formatClockEt(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(date)} ET`;
}
