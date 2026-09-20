/*
 * The pure view logic behind the public /daily landing page: how a day change
 * is worded and coloured, where each level sits on the bar, and which brief
 * fields become highlights. The page is a server component and cannot run here,
 * so these are the parts a wrong change would break silently.
 *
 * Run: npm run verify:daily
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { formatChangePct, changeTone, buildLevelScale, dailyHighlights, moodHeadline } = await import(
  '../src/lib/daily/view.ts'
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

section('formatChangePct signs and rounds a fractional change');
ok('+1.23% -> +1.2%', formatChangePct(0.0123) === '+1.2%', formatChangePct(0.0123));
ok('-0.34% -> -0.3%', formatChangePct(-0.0034) === '-0.3%', formatChangePct(-0.0034));
ok('zero is signed +0.0%', formatChangePct(0) === '+0.0%', formatChangePct(0));
ok('non-finite is a dash', formatChangePct(NaN) === '—');

section('changeTone has a dead-band around flat');
ok('a clear gain is pos', changeTone(0.01) === 'pos');
ok('a clear drop is neg', changeTone(-0.01) === 'neg');
ok('a rounding-level move is neutral', changeTone(0.0001) === 'neutral');
ok('exactly flat is neutral', changeTone(0) === 'neutral');
ok('non-finite is neutral', changeTone(NaN) === 'neutral');

section('buildLevelScale places markers in price order and needs spot + a level');
{
  const s = buildLevelScale({ floor: 600, flip: 608, spot: 610, ceiling: 615 });
  ok('drawable with spot and levels', s.drawable === true);
  ok('all four markers present', s.markers.length === 4);
  const byKey = Object.fromEntries(s.markers.map((m) => [m.key, m]));
  ok('floor sits left of ceiling', byKey.floor.pct < byKey.ceiling.pct);
  ok('spot between floor and ceiling', byKey.floor.pct < byKey.spot.pct && byKey.spot.pct < byKey.ceiling.pct);
  ok('every pct within 0..100', s.markers.every((m) => m.pct >= 0 && m.pct <= 100));
  ok('the balance-point label is plain English', byKey.flip.label === 'Balance point');
  ok('the current-price marker reads "Now"', byKey.spot.label === 'Now');
}
{
  // Missing levels: only the present, positive, finite values become markers.
  const s = buildLevelScale({ floor: null, flip: null, spot: 610, ceiling: 615 });
  ok('drawable with spot + one level', s.drawable === true);
  ok('only two markers', s.markers.length === 2, String(s.markers.length));
}
ok('spot alone is not drawable', buildLevelScale({ floor: null, flip: null, spot: 610, ceiling: null }).drawable === false);
ok('levels with no spot are not drawable', buildLevelScale({ floor: 600, flip: 608, spot: null, ceiling: 615 }).drawable === false);
ok('a zero/negative level is dropped', buildLevelScale({ floor: 0, flip: -1, spot: 610, ceiling: 615 }).markers.length === 2);
{
  // Collapsed domain (all equal) must not divide by zero.
  const s = buildLevelScale({ floor: 610, flip: 610, spot: 610, ceiling: 610 });
  ok('collapsed domain stacks at the middle', s.markers.every((m) => m.pct === 50));
}

section('dailyHighlights pulls only public-safe brief fields');
{
  const brief = { date: '2026-09-18', spy: 0.1, qqq: 0.2, iwm: -0.1, vix: 15, topStory: '  Futures firm  ', earningsToday: [' AAPL ', '', 'MSFT', 'NVDA', 'AMD'] };
  const h = dailyHighlights(brief);
  ok('top story trimmed', h.topStory === 'Futures firm', h.topStory);
  ok('earnings capped at 3 and trimmed', h.earnings.join(',') === 'AAPL,MSFT,NVDA', h.earnings.join(','));
}
ok('no brief yields empty highlights', (() => { const h = dailyHighlights(null); return h.topStory === null && h.earnings.length === 0; })());
ok('blank story becomes null', dailyHighlights({ date: 'x', topStory: '   ', earningsToday: [] }).topStory === null);

section('moodHeadline maps the internal wild mood to the reader-facing "Choppy"');
ok('calm stays calm', moodHeadline('calm').word === 'Calm' && moodHeadline('calm').emoji === '🟡');
ok('wild reads as Choppy', moodHeadline('wild').word === 'Choppy' && moodHeadline('wild').emoji === '🔴');

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
