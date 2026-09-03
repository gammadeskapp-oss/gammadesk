/*
 * Validation of the market-phase reader in src/lib/marketPhase.ts.
 *
 * This module writes the line every page shows outside regular hours, so a
 * wrong answer here is not a subtle scoring error — it is the site telling a
 * first-time visitor that the market opens on a day it does not, or calling a
 * Saturday afternoon "pre-open". The table below is the specification: each
 * row is a moment on the New York clock and the sentence that moment earns.
 *
 * It shares a calendar with `verify:staleness` and deliberately re-checks the
 * holiday and early-close cases from the other side: that suite proves the
 * stale banner stays quiet on Thanksgiving, this one proves the session notice
 * does not then tell anyone the market opens in an hour.
 *
 * Run: npm run verify:market-phase
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { marketTimeToUtcMs } = await import('../src/lib/time.ts');
const { marketStatus, nextSession } = await import('../src/lib/marketPhase.ts');
const { sessionRules } = await import('../src/lib/events/rules.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function eq(label, actual, expected) {
  ok(
    label,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function section(name) {
  console.log(`\n${name}`);
}

/** New York wall clock -> Date. */
function et(date, hour, minute = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(marketTimeToUtcMs(y, m, d, hour, minute));
}

/*
 * The same settled late-August 2026 week `verify:staleness` uses: no DST
 * boundary, no real holiday, so the synthetic calendar below is the only thing
 * that closes a day.
 */
const MON = '2026-08-24';
const TUE = '2026-08-25';
const WED = '2026-08-26';
const THU = '2026-08-27';
const FRI = '2026-08-28';
const SAT = '2026-08-29';

// WED is closed, THU shuts at 13:00.
const rules = sessionRules({
  events: [],
  marketCalendar: [
    { date: WED, status: 'closed', name: 'Test holiday', confirmed: true },
    {
      date: THU,
      status: 'early-close',
      closeEt: '13:00',
      name: 'Test early close',
      confirmed: true,
    },
  ],
});

section('The four phases');

eq('inside the session', marketStatus(et(TUE, 11), rules).phase, 'open');
eq('before the open', marketStatus(et(TUE, 7), rules).phase, 'pre-open');
eq('after the close', marketStatus(et(TUE, 20), rules).phase, 'after-close');
eq('on a Saturday', marketStatus(et(SAT, 12), rules).phase, 'closed-day');
eq('on a holiday', marketStatus(et(WED, 11), rules).phase, 'closed-day');

section('Nothing is said while the market is open');

{
  const open = marketStatus(et(TUE, 11), rules);
  ok('no showing line', open.showingLine === '', open.showingLine);
  ok('no next-update line', open.nextUpdateLine === '', open.nextUpdateLine);
  ok('and `open` agrees with the phase', open.open === true);
}

section('The lines name the right session');

{
  // 09:29 on Tuesday: Monday's close is the newest thing that exists.
  const preOpen = marketStatus(et(TUE, 9, 29), rules);
  ok(
    'pre-open says the market has not opened',
    /has not opened yet/.test(preOpen.showingLine),
    preOpen.showingLine,
  );
  eq('pre-open shows the previous session', preOpen.lastSession.date, MON);
  eq('and points at today for the next one', preOpen.nextSession.date, TUE);
  ok(
    'the next-update line says today',
    /opens today at 09:30 ET/.test(preOpen.nextUpdateLine),
    preOpen.nextUpdateLine,
  );
}

{
  // 20:00 Tuesday: the reader watched today's session; saying "last session"
  // would be true and would still sound like yesterday's data.
  const evening = marketStatus(et(TUE, 20), rules);
  eq("evening shows today's close", evening.lastSession.date, TUE);
  ok(
    'and calls it today',
    /Showing today's close/.test(evening.showingLine),
    evening.showingLine,
  );
}

section('Holidays are skipped in both directions');

{
  // Tuesday evening, with Wednesday closed: the next session is Thursday.
  const evening = marketStatus(et(TUE, 20), rules);
  eq('the closed Wednesday is skipped', evening.nextSession.date, THU);
  ok(
    'and the reader is told which day',
    evening.nextUpdateLine.includes('Thu 27 Aug'),
    evening.nextUpdateLine,
  );
}

{
  // Wednesday itself: closed all day, and the previous session is Tuesday.
  const holiday = marketStatus(et(WED, 11), rules);
  eq('a holiday is not pre-open', holiday.phase, 'closed-day');
  eq('it shows Tuesday', holiday.lastSession.date, TUE);
  eq('and points at Thursday', holiday.nextSession.date, THU);
}

section('Early closes are named, not silently shortened');

{
  // 14:00 Thursday, after the 13:00 close.
  const afterEarly = marketStatus(et(THU, 14), rules);
  eq('the early close has passed', afterEarly.phase, 'after-close');
  eq('and it is the session on screen', afterEarly.lastSession.date, THU);
  ok(
    'the line says so',
    /early close/.test(afterEarly.showingLine),
    afterEarly.showingLine,
  );
  ok(
    'and gives the shortened time',
    /13:00 ET/.test(afterEarly.showingLine),
    afterEarly.showingLine,
  );
}

{
  // 12:00 Thursday is still inside the shortened session.
  eq('before 13:00 it is still open', marketStatus(et(THU, 12), rules).phase, 'open');
}

section('The weekend points at Monday, not at tomorrow');

{
  const saturday = marketStatus(et(SAT, 12), rules);
  eq('Friday is what is on screen', saturday.lastSession.date, FRI);
  eq('and Monday is next', saturday.nextSession.date, '2026-08-31');
  ok(
    'named in the line',
    saturday.nextUpdateLine.includes('Mon 31 Aug'),
    saturday.nextUpdateLine,
  );
}

section('nextSession returns the session in progress, not the one after it');

eq(
  'mid-session, the current day is the next session',
  nextSession(et(TUE, 11), rules).date,
  TUE,
);
eq(
  'after the close it moves on',
  nextSession(et(TUE, 17), rules).date,
  THU,
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
