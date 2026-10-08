/*
 * Validation of the Fed/Treasury events feed's pure logic.
 *
 * Why this file exists: the feed decides what lands on the events calendar
 * across the dashboard, /decision, /scanner, /daily and the X posts, and a
 * silent parser drift or a mis-classified importance would quietly mislead a
 * reader about what the day holds. The network fetch and the Blob store cannot
 * run here, so everything testable is pure: the two parsers (against fixtures),
 * the importance tables, the ET→CT clock, the merge/dedupe, the keep-old-on-
 * failure fold, the window trim, the X wording and heads-up decision, and the
 * production seeding guard.
 *
 * Run: npm run verify:fed-events
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const {
  fedBoardImportance,
  treasuryAuctionImportance,
  etToCt,
  buildFetchedEvent,
} = await import('../src/lib/events/feed/types.ts');
const { parseFedBoardCalendar, extractWho, parseTimeEt } = await import(
  '../src/lib/events/feed/sources/fedBoardParse.ts'
);
const { parseTreasuryAuctions, termYears } = await import(
  '../src/lib/events/feed/sources/treasuryParse.ts'
);
const { mergeEvents, eventsWithin, addDays } = await import('../src/lib/events/feed/merge.ts');
const { foldRefresh, emptyFeedDoc, allFeedEvents } = await import('../src/lib/events/feed/fold.ts');
const { seededFeedEvents, seedingAllowed } = await import('../src/lib/events/feed/fixtures.ts');
const { eventsForRow } = await import('../src/lib/events/rules.ts');
const { morningEventsLine, dueEventHeadsUp, eventHeadsUpText, to12h } = await import(
  '../src/lib/x/eventsLine.ts'
);
const { checkPost } = await import('../src/lib/x/compose.ts');

let failures = 0;
let checks = 0;
function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(name) {
  console.log(`\n${name}`);
}

const TODAY = '2026-10-08';
const WEEK = addDays(TODAY, 7); // 2026-10-15

// --- the Fed Board parser, against a fixture ---------------------------------

section('Fed Board parser reads the fixture calendar');

const FED_HTML = `
  <div class="eventlist">
    <div class="row eventlist__event">
      <time datetime="${TODAY} 09:15">9:15 a.m. EDT</time>
      <p class="eventlist__title">Governor Waller speaks on the economic outlook</p>
    </div>
    <div class="row eventlist__event">
      <time datetime="${TODAY} 12:30">12:30 p.m. EDT</time>
      <p class="eventlist__title">Chair Powell gives opening remarks</p>
    </div>
    <div class="row eventlist__event">
      <time datetime="${TODAY} 14:00">2:00 p.m. EDT</time>
      <p class="eventlist__title">FOMC: Minutes of the September 2026 meeting</p>
    </div>
  </div>
`;
const fed = parseFedBoardCalendar(FED_HTML, { sourceUrl: 'https://www.federalreserve.gov/x.htm' });
const byName = (list, needle) => list.find((e) => e.name.toLowerCase().includes(needle));

ok('parsed three Fed events', fed.length === 3, String(fed.length));
const waller = byName(fed, 'waller');
const powell = byName(fed, 'powell');
const minutes = byName(fed, 'minutes');
ok('Waller time ET is 09:15', waller?.timeEt === '09:15', waller?.timeEt);
ok('Waller time CT is 08:15', waller?.timeCt === '08:15', waller?.timeCt);
ok('Waller is MEDIUM (a governor speech)', waller?.importance === 'medium', waller?.importance);
ok('Waller "who" is Governor Waller', waller?.who === 'Governor Waller', waller?.who);
ok('Powell is HIGH (the Chair)', powell?.importance === 'high', powell?.importance);
ok('Powell "who" is Chair Powell', powell?.who === 'Chair Powell', powell?.who);
ok('Powell CT is 11:30', powell?.timeCt === '11:30', powell?.timeCt);
ok('FOMC minutes are MEDIUM', minutes?.importance === 'medium', minutes?.importance);
ok('FOMC minutes ET 14:00 → CT 13:00', minutes?.timeEt === '14:00' && minutes?.timeCt === '13:00');
ok('every Fed event carries the source URL', fed.every((e) => e.source === 'fed-board' && e.sourceUrl));

// parser helpers
ok('parseTimeEt reads an ISO datetime', parseTimeEt('2026-10-08 14:00', '') === '14:00');
ok('parseTimeEt falls back to a display time', parseTimeEt('2026-10-08', '2:00 p.m.') === '14:00');
ok('parseTimeEt returns null for an all-day entry', parseTimeEt('2026-10-08', '') === null);
ok('extractWho finds the Chair', extractWho('Chair Powell testifies') === 'Chair Powell');
ok('extractWho finds a governor', extractWho('Governor Bowman speaks') === 'Governor Bowman');
ok('extractWho is empty when nobody is named', extractWho('FOMC: Minutes released') === '');

// --- Fed Board importance table ----------------------------------------------

section('Fed Board importance');

ok('FOMC statement is HIGH', fedBoardImportance('FOMC statement and rate decision') === 'high');
ok('FOMC press conference is HIGH', fedBoardImportance('FOMC press conference') === 'high');
ok('Chair speech is HIGH', fedBoardImportance('Chair Powell speaks', { who: 'Chair Powell' }) === 'high');
ok('FOMC minutes are MEDIUM', fedBoardImportance('FOMC: Minutes of the meeting') === 'medium');
ok('Governor speech is MEDIUM', fedBoardImportance('Governor Waller speaks', { who: 'Governor Waller' }) === 'medium');
ok('an unrelated Board note is LOW', fedBoardImportance('Beige Book released') === 'low');

// --- Treasury parser + importance, against a fixture -------------------------

section('Treasury parser reads the fixture auctions');

const TSY_JSON = [
  { securityType: 'Note', securityTerm: '10-Year', auctionDate: `${TODAY}T00:00:00` },
  { securityType: 'Bond', securityTerm: '30-Year', auctionDate: addDays(TODAY, 1) },
  { securityType: 'Bill', securityTerm: '4-Week', auctionDate: TODAY },
  { securityType: 'Note', securityTerm: '2-Year', auctionDate: addDays(TODAY, 20) },
];
const tsyAll = parseTreasuryAuctions(TSY_JSON, { sourceUrl: 'https://www.treasurydirect.gov/x/' });
const tsy = eventsWithin(tsyAll, TODAY, WEEK);
const ten = byName(tsy, '10-year');
const bill = byName(tsy, '4-week');

ok('parsed four auctions before the window trim', tsyAll.length === 4, String(tsyAll.length));
ok('the 2-year outside the 7-day window is trimmed off', tsy.length === 3, String(tsy.length));
ok('the 10-year note is MEDIUM', ten?.importance === 'medium', ten?.importance);
ok('note auctions default to 13:00 ET', ten?.timeEt === '13:00', ten?.timeEt);
ok('the 4-week bill is LOW', bill?.importance === 'low', bill?.importance);
ok('bill auctions default to 11:30 ET', bill?.timeEt === '11:30', bill?.timeEt);
ok('termYears reads 10-Year', termYears('10-Year') === 10);
ok('termYears is null for a 4-Week bill', termYears('4-Week') === null);
ok('10y+ is MEDIUM, under-10y is LOW', treasuryAuctionImportance('Note', 10) === 'medium' && treasuryAuctionImportance('Note', 2) === 'low');

// --- ET → CT and the 12-hour label -------------------------------------------

section('Clock conversions');

ok('etToCt subtracts an hour', etToCt('14:00') === '13:00');
ok('etToCt wraps past midnight', etToCt('00:15') === '23:15');
ok('etToCt rejects a bad input', etToCt('25:00') === null);
ok('to12h renders afternoon', to12h('13:00') === '1:00 PM');
ok('to12h renders morning', to12h('09:15') === '9:15 AM');
ok('to12h renders noon and midnight', to12h('12:00') === '12:00 PM' && to12h('00:00') === '12:00 AM');

// --- merge + dedupe: the bundled calendar shows through ----------------------

section('Merge keeps the bundled calendar and de-dupes against the fetch');

const bundled = [
  { date: TODAY, timeEt: '08:30', name: 'CPI', importance: 'high', confirmed: true },
  // A hand-maintained guess at the same minutes the fetch also returns.
  { date: TODAY, timeEt: '14:00', name: 'FOMC: Minutes of the September 2026 meeting', importance: 'medium', confirmed: true },
];
const merged = mergeEvents(bundled, fed);
ok('CPI (bundled-only) survives the merge', merged.some((e) => e.name === 'CPI'));
ok('the duplicated FOMC minutes appears once', merged.filter((e) => /minutes/i.test(e.name)).length === 1);
ok('the fetched copy (with a source URL) wins the dedupe', byName(merged, 'minutes')?.sourceUrl);
ok('a failed fetch ([]) leaves the bundled calendar intact', mergeEvents(bundled, []).length === bundled.length);
ok('merged events are in date+time order', merged[0].timeEt <= merged[merged.length - 1].timeEt);

// eventsForRow (the real read path) over the merged list
const cal = { events: merged, marketCalendar: [] };
const row = eventsForRow(cal, TODAY);
ok('today\'s row carries CPI, Waller, Powell and the minutes', ['CPI', 'Waller', 'Powell', 'Minutes'].every((n) => row.some((e) => e.name.includes(n))));

// --- keep-old-on-failure fold ------------------------------------------------

section('A source that fails keeps its last good events');

const A = buildFetchedEvent({ date: TODAY, timeEt: '14:00', name: 'FOMC: Minutes', importance: 'medium', source: 'fed-board', sourceUrl: 'u' });
const B1 = buildFetchedEvent({ date: TODAY, timeEt: '13:00', name: '10-Year Note auction', importance: 'medium', source: 'treasury', sourceUrl: 'u' });
const B2 = buildFetchedEvent({ date: addDays(TODAY, 1), timeEt: '13:00', name: '30-Year Bond auction', importance: 'medium', source: 'treasury', sourceUrl: 'u' });
const now1 = new Date('2026-10-08T11:00:00Z');
const now2 = new Date('2026-10-08T17:00:00Z');

let doc = foldRefresh(emptyFeedDoc(), { 'fed-board': { ok: true, events: [A] }, treasury: { ok: true, events: [B1] } }, now1);
ok('first fold stores both sources', allFeedEvents(doc).length === 2);

doc = foldRefresh(doc, { 'fed-board': { ok: false, error: 'HTTP 503' }, treasury: { ok: true, events: [B2] } }, now2);
ok('the failed Fed source keeps its last good event', doc.bySource['fed-board'].events.length === 1);
ok('the failed source records the error', doc.bySource['fed-board'].lastError === 'HTTP 503');
ok('the Treasury source updated to the new events', doc.bySource['treasury'].events[0].name.includes('30-Year'));
ok('the calendar is not blanked by the failure', allFeedEvents(doc).length === 2);

// --- seeding is development-only ---------------------------------------------

section('Seeding is honoured outside production only');

ok('seeding allowed in development', seedingAllowed('development') === true);
ok('seeding allowed when unset', seedingAllowed(undefined) === true);
ok('seeding REFUSED in production', seedingAllowed('production') === false);

const seeded = seededFeedEvents(TODAY);
ok('the seed carries the representative day', ['Powell', 'Waller', 'Minutes', '10-Year'].every((n) => seeded.some((e) => e.name.includes(n))));
ok('the seed has both sources', seeded.some((e) => e.source === 'fed-board') && seeded.some((e) => e.source === 'treasury'));
ok('the seed does NOT include a regional president (the pending TODO)', !seeded.some((e) => /kashkari|musalem|schmid|logan/i.test(e.name)));

// --- the X morning line ------------------------------------------------------

section('The morning events line');

const line = morningEventsLine(seeded, TODAY);
ok('names something', Boolean(line) && line.startsWith('📅 Today:'), line ?? 'null');
ok('leads with the HIGH event (Powell)', line.indexOf('Powell') < line.indexOf('Waller'), line);
ok('uses CT 12-hour times', line.includes('11:30 AM CT'), line);
ok('a quiet calendar yields no line', morningEventsLine([], TODAY) === null);
ok('only low-importance items yield no line',
  morningEventsLine([buildFetchedEvent({ date: TODAY, timeEt: '11:30', name: '4-Week Bill auction', importance: 'low', source: 'treasury', sourceUrl: 'u' })], TODAY) === null);

// --- the intraday heads-up ---------------------------------------------------

section('The intraday heads-up fires once, 15 minutes out, capped at two a day');

// Powell is at 12:30 ET = 750 minutes past midnight. 740 → 10 minutes out.
const due = dueEventHeadsUp(seeded, { today: TODAY, etMinutesNow: 740, postedKeys: [], postedCount: 0 });
ok('a high/medium event 10 min out is due', due?.event.name.includes('Powell'), due?.event.name);
ok('the heads-up reports the minutes until', due?.minutesUntil === 10, String(due?.minutesUntil));
ok('nothing is due half an hour out', dueEventHeadsUp(seeded, { today: TODAY, etMinutesNow: 700, postedKeys: [], postedCount: 0 }) === null);
ok('nothing is due once the event has started', dueEventHeadsUp(seeded, { today: TODAY, etMinutesNow: 760, postedKeys: [], postedCount: 0 }) === null);
ok('an already-flagged event is not re-flagged', dueEventHeadsUp(seeded, { today: TODAY, etMinutesNow: 740, postedKeys: [due.key], postedCount: 1 }) === null);
ok('the day\'s cap of two is enforced', dueEventHeadsUp(seeded, { today: TODAY, etMinutesNow: 740, postedKeys: [], postedCount: 2 }) === null);

const headsUp = eventHeadsUpText(due.event, due.minutesUntil);
ok('the heads-up text passes the post self-check', checkPost(headsUp).length === 0, checkPost(headsUp).join(' '));
ok('the heads-up mentions the CT time', headsUp.includes('11:30 AM CT'), headsUp);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
