/*
 * Validation of the US net liquidity maths in src/lib/netLiquidity.ts.
 *
 * As with scripts/verify-greeks.js, the logic is transcribed here rather than
 * imported, so this is an independent check rather than a function tested
 * against itself. Keep the two in sync when either changes.
 *
 * Two things this exists to catch, both of which produce a confident,
 * plausible, wrong number rather than an obvious break:
 *
 *   1. Unit mismatch. WALCL and WTREGEN are published in millions of dollars,
 *      RRPONTSYD in billions. Subtracting them raw understates the repo drain
 *      a thousandfold and still renders a believable trillions figure.
 *
 *   2. Daily contamination. Only RRPONTSYD is daily. If a repo print from
 *      after the Wednesday leaks into that week's figure, the series appears
 *      to move every day, and every one of those moves is an artefact.
 *
 * The last section fetches the real FRED series and checks the parser against
 * them. It is skipped, not failed, when there is no network.
 *
 * ESM (.mjs) rather than .js like its siblings, because the live section uses
 * top-level await.
 *
 * Run: npm run verify:netliq
 */

let failures = 0;
let checks = 0;
let skipped = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(label, actual, expected, tolerance = 1e-6) {
  ok(
    label,
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

// ---- transcribed from netLiquidity.ts --------------------------------------

const MILLIONS = 1e6;
const BILLIONS = 1e9;

function asOf(series, date) {
  let found = null;
  for (const o of series) {
    if (o.date > date) break;
    found = o;
  }
  return found;
}

function directionOf(changePct, thresholdPct) {
  if (Math.abs(changePct) < thresholdPct) return 'flat';
  return changePct > 0 ? 'rising' : 'falling';
}

function computeWeeks(walcl, tga, rrp, thresholdPct, historyWeeks) {
  const weeks = [];
  for (const balance of walcl.slice(-(historyWeeks + 1))) {
    const tgaAt = asOf(tga, balance.date);
    const rrpAt = asOf(rrp, balance.date);
    if (!tgaAt || !rrpAt) continue;

    weeks.push({
      weekOf: balance.date,
      net:
        balance.value * MILLIONS - tgaAt.value * MILLIONS - rrpAt.value * BILLIONS,
      walcl: balance.value * MILLIONS,
      tga: tgaAt.value * MILLIONS,
      rrp: rrpAt.value * BILLIONS,
      changeUsd: null,
      changePct: null,
      direction: null,
    });
  }

  for (let i = 1; i < weeks.length; i += 1) {
    const previous = weeks[i - 1];
    const week = weeks[i];
    const changeUsd = week.net - previous.net;
    week.changeUsd = changeUsd;
    week.changePct =
      previous.net !== 0 ? (changeUsd / Math.abs(previous.net)) * 100 : null;
    week.direction =
      week.changePct === null ? null : directionOf(week.changePct, thresholdPct);
  }

  return weeks.slice(-historyWeeks);
}

function parseCsv(body) {
  const out = [];
  for (const line of body.split('\n').slice(1)) {
    const [date, raw] = line.trim().split(',');
    if (!date || !raw || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

// ---- 1. units --------------------------------------------------------------

console.log('\nunit normalisation');

/* Real FRED prints, read 2026-08-16. */
const WALCL = [
  { date: '2026-07-29', value: 6738190 },
  { date: '2026-08-05', value: 6748567 },
  { date: '2026-08-12', value: 6759955 },
];
const TGA = [
  { date: '2026-07-29', value: 910776 },
  { date: '2026-08-05', value: 907324 },
  { date: '2026-08-12', value: 963950 },
];
const RRP = [
  { date: '2026-08-05', value: 0.9 },
  { date: '2026-08-12', value: 0.725 },
];

{
  const weeks = computeWeeks(WALCL, TGA, RRP, 0.25, 10);
  const latest = weeks[weeks.length - 1];

  // 6,759,955M − 963,950M − 0.725B = $5.79528T
  near('week of 2026-08-12 nets to $5.79528T', latest.net, 5_795_280 * MILLIONS, 1);
  ok(
    'the result lands in the trillions, not the billions',
    latest.net > 1e12 && latest.net < 1e13,
    `got ${latest.net}`,
  );
  near('reverse repo is scaled from billions', latest.rrp, 0.725 * BILLIONS, 1);
  near('balance sheet is scaled from millions', latest.walcl, 6759955 * MILLIONS, 1);
}

// ---- 2. weekly cadence, not daily ------------------------------------------

console.log('\nweekly cadence');

{
  /*
   * The guard that matters. Two repo prints land after the last Wednesday. A
   * daily recomputation would pair them against week-old WALCL and TGA and
   * report movement; the weekly series must ignore them entirely.
   */
  const withLaterRrp = [
    ...RRP,
    { date: '2026-08-13', value: 0.45 },
    { date: '2026-08-14', value: 0.25 },
  ];

  const base = computeWeeks(WALCL, TGA, RRP, 0.25, 10);
  const contaminated = computeWeeks(WALCL, TGA, withLaterRrp, 0.25, 10);

  near(
    'repo prints after the Wednesday do not move that week',
    contaminated[contaminated.length - 1].net,
    base[base.length - 1].net,
    1,
  );
  ok(
    'no extra week appears for the daily prints',
    contaminated.length === base.length,
    `${base.length} -> ${contaminated.length}`,
  );
}

{
  // Forward fill: no repo print on the Wednesday falls back to the last one.
  const sparse = [{ date: '2026-08-03', value: 2 }];
  const weeks = computeWeeks(WALCL, TGA, sparse, 0.25, 10);
  const latest = weeks[weeks.length - 1];
  near('a missing repo print forward-fills', latest.rrp, 2 * BILLIONS, 1);
}

{
  // A week with no prior print in some series is skipped, never half-filled.
  const lateTga = [{ date: '2026-08-12', value: 963950 }];
  const weeks = computeWeeks(WALCL, lateTga, RRP, 0.25, 10);
  ok(
    'weeks without every series are dropped, not partially computed',
    weeks.length === 1 && weeks[0].weekOf === '2026-08-12',
    `got ${weeks.map((w) => w.weekOf).join(',')}`,
  );
}

// ---- 3. direction threshold ------------------------------------------------

console.log('\ndirection threshold');

{
  const flat = [
    { date: '2026-08-05', value: 6_000_000 },
    // +0.13% — the exact case the brief calls rounding error, not a signal.
    { date: '2026-08-12', value: 6_007_800 },
  ];
  const zeroed = [
    { date: '2026-08-05', value: 0 },
    { date: '2026-08-12', value: 0 },
  ];
  const noRepo = [{ date: '2026-08-01', value: 0 }];

  const weeks = computeWeeks(flat, zeroed, noRepo, 0.25, 10);
  const latest = weeks[weeks.length - 1];

  near('a 0.13% week measures as 0.13%', latest.changePct, 0.13, 1e-9);
  ok(
    'a 0.13% week is labelled Flat, not rising',
    latest.direction === 'flat',
    `got ${latest.direction}`,
  );

  ok('exactly at the threshold is not flat', directionOf(0.25, 0.25) === 'rising');
  ok('above the threshold rises', directionOf(0.6, 0.25) === 'rising');
  ok('below the negative threshold falls', directionOf(-0.6, 0.25) === 'falling');
  ok('a small negative move is flat', directionOf(-0.2, 0.25) === 'flat');

  ok(
    'the first week has no direction to report',
    weeks[0].direction === null && weeks[0].changeUsd === null,
  );
}

// ---- 4. the real series ----------------------------------------------------

console.log('\nlive FRED series');

async function series(id) {
  const res = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`,
    { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`${id} returned ${res.status}`);
  return parseCsv(await res.text());
}

try {
  const [walcl, tga, rrp] = await Promise.all([
    series('WALCL'),
    series('WTREGEN'),
    series('RRPONTSYD'),
  ]);

  ok('WALCL parses', walcl.length > 100, `${walcl.length} rows`);
  ok('WTREGEN parses', tga.length > 100, `${tga.length} rows`);
  ok('RRPONTSYD parses', rrp.length > 100, `${rrp.length} rows`);

  const wednesdays = walcl.slice(-8).every((o) => {
    const day = new Date(`${o.date}T12:00:00Z`).getUTCDay();
    return day === 3;
  });
  ok('WALCL prints on Wednesdays', wednesdays);

  ok(
    'RRPONTSYD is denser than WALCL, i.e. genuinely daily',
    rrp.length > walcl.length,
    `${rrp.length} vs ${walcl.length}`,
  );

  const weeks = computeWeeks(walcl, tga, rrp, 0.25, 13);
  const latest = weeks[weeks.length - 1];

  ok(
    'live net liquidity is a plausible multi-trillion figure',
    latest.net > 3e12 && latest.net < 1e13,
    `got ${latest.net}`,
  );
  console.log(
    `  note  week of ${latest.weekOf}: $${(latest.net / 1e12).toFixed(3)}T` +
      ` (${latest.direction}, ${latest.changePct?.toFixed(3)}%)`,
  );
} catch (e) {
  skipped += 1;
  console.log(`  SKIP  live series unavailable — ${e.message}`);
}

// ---- result ----------------------------------------------------------------

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks` +
    `${skipped ? `, ${skipped} section skipped` : ''}\n`,
);
process.exit(failures === 0 ? 0 : 1);
