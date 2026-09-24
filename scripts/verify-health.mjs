/*
 * The pure logic behind the nightly health check: the report summary, the
 * email subject and body, the 30-day history trim, the "expected posts" rule,
 * and the required-env list. The IO (fetching pages, probing Blob, sending
 * mail) is exercised by running the check itself, not here.
 *
 * Run: npm run verify:health
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { toReport, subjectFor, emailBody, trimHistory, evaluateExpectedPosts, missingEnv } = await import(
  '../src/lib/health/report.ts'
);

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

const sample = [
  { id: 'a', label: 'A', ok: true, detail: 'fine' },
  { id: 'b', label: 'B', ok: false, detail: 'broke' },
  { id: 'c', label: 'C', ok: false, detail: 'also broke' },
];

section('toReport counts failures');
{
  const r = toReport('2026-09-18', '2026-09-18T02:00:00Z', sample);
  ok('total is the number of checks', r.total === 3);
  ok('failed counts the false ones', r.failed === 2, String(r.failed));
  ok('date + ranAt carried through', r.date === '2026-09-18' && r.ranAt === '2026-09-18T02:00:00Z');
}

section('subjectFor names the count and pluralises');
ok('two failures', subjectFor(2) === 'GammaDesk: 2 checks failed', subjectFor(2));
ok('one failure is singular', subjectFor(1) === 'GammaDesk: 1 check failed', subjectFor(1));
ok('zero (pluralised, though it is never emailed)', subjectFor(0) === 'GammaDesk: 0 checks failed');

section('emailBody leads with the failures and names each');
{
  const body = emailBody(toReport('2026-09-18', '2026-09-18T02:00:00Z', sample));
  ok('mentions the count', body.includes('2 of 3 checks failed'));
  ok('lists a failed check with its detail', body.includes('✗ B — broke'));
  ok('does not omit the other failure', body.includes('✗ C — also broke'));
  ok('includes the full list with a pass', body.includes('✓ A — fine'));
}

section('trimHistory overwrites same-date and keeps newest N');
{
  const history = [
    toReport('2026-09-17', 'x', sample),
    toReport('2026-09-16', 'x', sample),
  ];
  const next = toReport('2026-09-18', 'x', sample);
  const out = trimHistory(history, next, 30);
  ok('new report is first (newest)', out[0].date === '2026-09-18');
  ok('length grows by one', out.length === 3);

  // A re-run for an existing date replaces, not appends.
  const rerun = toReport('2026-09-17', 'y', [{ id: 'a', label: 'A', ok: true, detail: 'now fine' }]);
  const replaced = trimHistory(out, rerun, 30);
  ok('same-date re-run does not duplicate', replaced.filter((r) => r.date === '2026-09-17').length === 1);
  ok('same-date re-run keeps the newer content', replaced.find((r) => r.date === '2026-09-17').ranAt === 'y');
}
{
  // Cap at keepDays, newest kept. Use real September dates 01..28 plus two more
  // months so there are 40 distinct, sortable dates.
  const many = [];
  for (let d = 1; d <= 20; d += 1) many.push(toReport(`2026-07-${String(d).padStart(2, '0')}`, 'x', sample));
  for (let d = 1; d <= 20; d += 1) many.push(toReport(`2026-08-${String(d).padStart(2, '0')}`, 'x', sample));
  const capped = trimHistory(many.slice(1), many[0], 30);
  ok('never exceeds 30 days', capped.length === 30, String(capped.length));
  ok('newest date is first', capped[0].date === '2026-08-20', capped[0].date);
  ok('the oldest are dropped', !capped.some((r) => r.date === '2026-07-01'));
}

section('evaluateExpectedPosts only fires on a trading day with posting on');
ok('weekend passes with a reason', evaluateExpectedPosts([], '2026-09-19', { tradingDay: false, postingEnabled: true }).ok === true);
ok('posting off passes with a reason', evaluateExpectedPosts([], '2026-09-18', { tradingDay: true, postingEnabled: false }).ok === true);
{
  const rows = [
    { slot: 'morning', date: '2026-09-18', outcome: 'sent' },
    { slot: 'intraday', date: '2026-09-18', outcome: 'sent' },
    { slot: 'closing', date: '2026-09-18', outcome: 'sent' },
  ];
  ok('all three sent passes', evaluateExpectedPosts(rows, '2026-09-18', { tradingDay: true, postingEnabled: true }).ok === true);
}
{
  const rows = [{ slot: 'morning', date: '2026-09-18', outcome: 'sent' }];
  const r = evaluateExpectedPosts(rows, '2026-09-18', { tradingDay: true, postingEnabled: true });
  ok('missing closing + intraday fails', r.ok === false);
  ok('names what is missing', r.detail.includes('closing') && r.detail.includes('intraday'), r.detail);
}
ok('a skipped post does not count as sent', evaluateExpectedPosts(
  [{ slot: 'morning', date: '2026-09-18', outcome: 'skipped' }, { slot: 'closing', date: '2026-09-18', outcome: 'sent' }, { slot: 'intraday', date: '2026-09-18', outcome: 'sent' }],
  '2026-09-18',
  { tradingDay: true, postingEnabled: true },
).ok === false);
ok('yesterday\'s sends do not satisfy today', evaluateExpectedPosts(
  [{ slot: 'morning', date: '2026-09-17', outcome: 'sent' }],
  '2026-09-18',
  { tradingDay: true, postingEnabled: true },
).ok === false);

section('missingEnv lists exactly the absent required vars');
{
  const set = new Set(['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'BRIEF_TOKEN', 'X_POSTING_ENABLED']);
  ok('all present -> empty', missingEnv((n) => set.has(n)).length === 0);
  set.delete('BRIEF_TOKEN');
  set.delete('X_ACCESS_SECRET');
  const miss = missingEnv((n) => set.has(n));
  ok('reports the two removed', miss.includes('BRIEF_TOKEN') && miss.includes('X_ACCESS_SECRET'), miss.join(','));
  ok('reports only those two', miss.length === 2, miss.join(','));
}

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
