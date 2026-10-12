/*
 * Validation of the /flow screen's pure logic.
 *
 * The page makes plain-English claims a beginner acts on — a 0–100 "unusual
 * score", an EXTREME/LARGE flag, a one-line "what happened", and a per-ticker
 * money roll-up. All of it is decided in `score.ts` and `group.ts`, away from
 * the fetch, precisely so it can be walked here. This pins: the two flags and
 * both their gates, the score's monotonicity and bounds, the note's shape and
 * its refusal to imply direction, the far-OTM multi-leg caveat, and the
 * grouping/ordering by money.
 *
 * Run: npm run verify:flow
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { unusualScore, flagFor, shortNote, multiLegNote } = await import(
  '../src/lib/flow/score.ts'
);
const { groupByTicker, flowTotals, topTickers } = await import('../src/lib/flow/group.ts');
const {
  EXTREME_PREMIUM_USD,
  EXTREME_RATIO,
  LARGE_PREMIUM_USD,
  FAR_OTM_PCT,
  HUGE_VOLUME,
} = await import('../src/lib/flow/types.ts');

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

// --- flags --------------------------------------------------------------------

section('Flags — EXTREME needs BOTH a >10x ratio and >$1M; LARGE needs >$250k');

ok('EXTREME_RATIO is 10', EXTREME_RATIO === 10);
ok('EXTREME_PREMIUM_USD is 1,000,000', EXTREME_PREMIUM_USD === 1_000_000);
ok('LARGE_PREMIUM_USD is 250,000', LARGE_PREMIUM_USD === 250_000);

ok('ratio 12x + $2M -> extreme', flagFor({ volumeToOi: 12, premium: 2_000_000 }) === 'extreme');
ok('ratio 50x + $20k -> NOT extreme (money too small)',
  flagFor({ volumeToOi: 50, premium: 20_000 }) === null);
ok('ratio 2x + $5M -> large, not extreme (ratio too low)',
  flagFor({ volumeToOi: 2, premium: 5_000_000 }) === 'large');
ok('ratio 12x + $600k -> large, not extreme ($1M not cleared)',
  flagFor({ volumeToOi: 12, premium: 600_000 }) === 'large');
ok('exactly 10x + exactly $1M -> extreme (inclusive gates)',
  flagFor({ volumeToOi: 10, premium: 1_000_000 }) === 'extreme');
ok('$250k exactly -> large', flagFor({ volumeToOi: 1, premium: 250_000 }) === 'large');
ok('$249k -> no flag', flagFor({ volumeToOi: 1, premium: 249_000 }) === null);
ok('null premium, any ratio -> no flag', flagFor({ volumeToOi: 99, premium: null }) === null);

// --- score --------------------------------------------------------------------

section('Unusual score — bounded 0..100 and rises with money, ratio and nearness');

const allRows = [];
for (const premium of [null, 0, 40_000, 100_000, 1_000_000, 50_000_000, 500_000_000]) {
  for (const volumeToOi of [0, 0.5, 5, 20, 200]) {
    for (const distancePct of [0, 2, 10, 40, -60]) {
      allRows.push(unusualScore({ premium, volumeToOi, distancePct }));
    }
  }
}
ok('every score is an integer in [0,100]',
  allRows.every((s) => Number.isInteger(s) && s >= 0 && s <= 100));

ok('more money scores higher, all else equal',
  unusualScore({ premium: 5_000_000, volumeToOi: 5, distancePct: 1 }) >
    unusualScore({ premium: 100_000, volumeToOi: 5, distancePct: 1 }));
ok('higher ratio scores higher, all else equal',
  unusualScore({ premium: 1_000_000, volumeToOi: 20, distancePct: 1 }) >
    unusualScore({ premium: 1_000_000, volumeToOi: 1, distancePct: 1 }));
ok('nearer the money scores higher, all else equal',
  unusualScore({ premium: 1_000_000, volumeToOi: 5, distancePct: 0 }) >
    unusualScore({ premium: 1_000_000, volumeToOi: 5, distancePct: 40 }));
ok('a huge at-the-money print scores near the top',
  unusualScore({ premium: 50_000_000, volumeToOi: 25, distancePct: 0 }) >= 95);
ok('a tiny far-OTM low-ratio print scores low',
  unusualScore({ premium: 40_000, volumeToOi: 0.5, distancePct: 60 }) <= 10);
ok('null premium is treated as zero money, not NaN',
  Number.isInteger(unusualScore({ premium: null, volumeToOi: 20, distancePct: 0 })));

// --- the worked example from the brief ---------------------------------------

section('"What happened" — the brief\'s example, and it never implies direction');

const example = shortNote({
  premium: 14_100_000,
  volume: 20_000,
  openInterest: 122,
  volumeToOi: 164,
  type: 'put',
  distancePct: 0.2,
});
ok('reads "$14.1M of puts, 164x usual size, at the money."',
  example === '$14.1M of puts, 164x usual size, at the money.', example);
ok('is about twelve words or fewer', example.split(/\s+/).length <= 12, `${example.split(/\s+/).length} words`);

const directionProbe = [
  shortNote({ premium: 3_000_000, volume: 9000, openInterest: 500, volumeToOi: 18, type: 'put', distancePct: -2 }),
  shortNote({ premium: 300_000, volume: 900, openInterest: 100, volumeToOi: 9, type: 'call', distancePct: 6 }),
  shortNote({ premium: null, volume: 900, openInterest: 400, volumeToOi: 2.3, type: 'put', distancePct: 0.4 }),
];
const banned = /bearish|bullish|bet|bought|sold|buyer|seller/i;
ok('no note contains a direction/intent word', directionProbe.every((n) => !banned.test(n)),
  directionProbe.find((n) => banned.test(n)));
ok('a put note leads with dollars and the word "puts"',
  directionProbe[0].startsWith('$3') && directionProbe[0].includes('puts'));
ok('an unpriced note falls back to the contract count', directionProbe[2].startsWith('900 puts'),
  directionProbe[2]);
ok('sub-1x ratio omits the "usual size" clause',
  !shortNote({ premium: 400_000, volume: 300, openInterest: 600, volumeToOi: 0.5, type: 'call', distancePct: 3 }).includes('usual size'));

// --- multi-leg caveat ---------------------------------------------------------

section('Multi-leg caveat — only far from spot AND heavily traded');

ok('FAR_OTM_PCT is 50', FAR_OTM_PCT === 50);
ok('60% out + big volume -> caveat',
  multiLegNote({ distancePct: 60, volume: HUGE_VOLUME }) === 'Likely part of a larger multi-leg trade.');
ok('60% out but thin volume -> no caveat',
  multiLegNote({ distancePct: 60, volume: HUGE_VOLUME - 1 }) === null);
ok('at the money with big volume -> no caveat',
  multiLegNote({ distancePct: 1, volume: 100_000 }) === null);
ok('exactly 50% out is NOT "further than" -> no caveat',
  multiLegNote({ distancePct: 50, volume: 100_000 }) === null);

// --- grouping and money totals -----------------------------------------------

section('Grouping — by ticker, biggest dollars first, calls vs puts split right');

function row(symbol, type, premium, strike, volume = 1000) {
  return {
    symbol,
    expiration: '2026-10-16',
    expiryLabel: 'Oct 16',
    strike,
    type,
    volume,
    openInterest: 500,
    volumeToOi: volume / 500,
    premium,
    unusualScore: 50,
    shareOfChain: 0,
    flag: null,
    note: '',
    multiLegNote: null,
    spot: 100,
    distancePct: 0,
  };
}

const sample = [
  row('NVDA', 'call', 2_000_000, 150),
  row('NVDA', 'put', 500_000, 140),
  row('NVDA', 'call', 1_000_000, 160),
  row('SPY', 'put', 9_000_000, 560),
  row('AAPL', 'call', 300_000, 230),
  row('AAPL', 'call', null, 240), // unpriced
];

const groups = groupByTicker(sample);
ok('three tickers', groups.length === 3);
ok('SPY leads (most money)', groups[0].symbol === 'SPY', groups.map((g) => g.symbol).join(','));
ok('NVDA second, AAPL last by total $',
  groups[1].symbol === 'NVDA' && groups[2].symbol === 'AAPL');
ok('NVDA call money = $3M', groups[1].callPremium === 3_000_000);
ok('NVDA put money = $0.5M', groups[1].putPremium === 500_000);
ok('NVDA total = $3.5M', groups[1].totalPremium === 3_500_000);
ok('NVDA has 3 distinct strikes', groups[1].strikeCount === 3);
ok('within NVDA, biggest premium first', groups[1].rows[0].premium === 2_000_000);
ok('unpriced AAPL row sorts last within its ticker',
  groups[2].rows[groups[2].rows.length - 1].premium === null);

const totals = flowTotals(sample);
ok('day call money = 2M+1M+300k = $3.3M', totals.callPremium === 3_300_000);
ok('day put money = 500k+9M = $9.5M', totals.putPremium === 9_500_000);
ok('day total = $12.8M', totals.total === 12_800_000);

const top2 = topTickers(groups, 2);
ok('top-2 by money is [SPY, NVDA]',
  top2.length === 2 && top2[0].symbol === 'SPY' && top2[1].symbol === 'NVDA');

// --- summary ------------------------------------------------------------------

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
