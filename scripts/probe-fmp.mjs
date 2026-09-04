/*
 * One-shot probe: does FMP's economic calendar populate the estimate
 * (consensus) field for FUTURE-dated events?
 *
 * The macro translator's whole reason to consult FMP is to warn when the
 * hand-maintained consensus has gone stale — which only works if FMP carries an
 * estimate for a release *before* it prints. A calendar that fills the estimate
 * in only after the fact cannot do that, and in that case the FMP path should be
 * skipped entirely and the feature built on the local file alone.
 *
 * This does not touch application code. It makes one request over the next
 * fourteen days, filtered to US high-impact events, and prints how many
 * future-dated rows have a populated estimate. Read the verdict at the bottom.
 *
 * Run:  FMP_API_KEY=… node scripts/probe-fmp.mjs
 */

const key = process.env.FMP_API_KEY?.trim();
if (!key) {
  console.error(
    'No FMP_API_KEY in the environment. Set it and re-run:\n' +
      '  FMP_API_KEY=your_key node scripts/probe-fmp.mjs',
  );
  process.exit(2);
}

const now = new Date();
const from = now.toISOString().slice(0, 10);
const to = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);

// The `/stable` endpoint, not the legacy `/api/v3/economic_calendar`, which FMP
// retired on 2025-08-31 and now answers 403 for anyone but pre-cutoff legacy
// subscribers.
const url =
  'https://financialmodelingprep.com/stable/economic-calendar' +
  `?from=${from}&to=${to}&apikey=${encodeURIComponent(key)}`;

console.log(`Probing FMP economic calendar ${from} … ${to} (US, high impact)\n`);

let rows;
try {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`FMP returned HTTP ${response.status}.`);
    if (body) console.error(body.slice(0, 300));
    if (response.status === 402 || response.status === 403) {
      console.error(
        '\nVERDICT: SKIP FMP. The economic-calendar endpoint is not accessible on\n' +
          'this key\'s subscription, so it cannot cross-check consensus at all. Leave\n' +
          'GAMMADESK_MACRO_FMP unset and build on the local file only.',
      );
    }
    process.exit(1);
  }
  rows = await response.json();
} catch (e) {
  console.error(`Request failed: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(rows)) {
  console.error('Unexpected response shape (not an array).');
  process.exit(1);
}

const nowMs = now.getTime();
const us = rows.filter(
  (r) => r?.country === 'US' && String(r?.impact ?? '').toLowerCase() === 'high',
);
const future = us.filter((r) => Date.parse(r?.date) > nowMs);
const withEstimate = future.filter((r) => typeof r?.estimate === 'number');

for (const r of future.slice(0, 20)) {
  const has = typeof r.estimate === 'number' ? `estimate=${r.estimate}` : 'estimate=EMPTY';
  console.log(`  ${r.date}  ${r.event}  —  ${has}`);
}

console.log('');
console.log(`US high-impact events in window: ${us.length}`);
console.log(`  future-dated: ${future.length}`);
console.log(`  future-dated with a populated estimate: ${withEstimate.length}`);
console.log('');

if (future.length === 0) {
  console.log(
    'VERDICT: inconclusive — no future-dated US high-impact events in the next\n' +
      'fortnight. Re-run closer to a release, or widen the window.',
  );
  process.exit(0);
}

if (withEstimate.length === 0) {
  console.log(
    'VERDICT: SKIP FMP. The estimate field is empty for every future-dated event,\n' +
      'so FMP cannot cross-check consensus before a release. Leave\n' +
      'GAMMADESK_MACRO_FMP unset and build on the local file only.',
  );
  process.exit(0);
}

console.log(
  `VERDICT: FMP is usable — ${withEstimate.length} of ${future.length} future events carry an\n` +
    'estimate. The cross-check in lib/macro/consensus.ts can be enabled with\n' +
    'GAMMADESK_MACRO_FMP=1 once the display-licensing question is settled.',
);
