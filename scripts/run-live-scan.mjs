/*
 * A real end-to-end scanner run, driven from the command line.
 *
 * ## Why this exists
 *
 * The scan is normally three cron endpoints an hour apart, and verifying a
 * change to it means either waiting for tomorrow morning or trusting a
 * fixture. Neither answers "what does the header actually say with the real
 * universe in it". This runs the same three library functions the routes call,
 * in the same order, against real market data, and prints the numbers the page
 * renders.
 *
 * It writes to whatever store the environment points at — so check
 * `storeStatus()` in the output before running it anywhere that matters. With
 * no Blob token it writes local files and touches nothing shared.
 *
 * Run:
 *   node --conditions=react-server --experimental-transform-types \
 *     scripts/run-live-scan.mjs [rs|gamma|scan|all]
 */

import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

// --- env ---------------------------------------------------------------------

for (const file of ['.env.local', '.env.development.local']) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Later files win, matching Next's precedence.
    process.env[match[1]] = value;
  }
}
delete process.env.VERCEL;

const HOOK = `
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context);
    } catch {
      try {
        return await next(specifier + '/index.ts', context);
      } catch {
        // Neither — let the default resolver report it.
      }
    }
  }
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOK)}`, import.meta.url);

// --- run ---------------------------------------------------------------------

const stage = process.argv[2] ?? 'all';

const { storeStatus } = await import('../src/lib/jsonStore.ts');
console.log('store:', JSON.stringify(storeStatus()));

if (stage === 'rs' || stage === 'all') {
  const { refreshShard } = await import('../src/lib/rs/refresh.ts');
  const { SHARDS } = await import('../src/lib/rs/universe.ts');

  for (let shard = 0; shard < SHARDS; shard += 1) {
    const started = Date.now();
    const report = await refreshShard(shard);
    console.log(
      `[rs] shard ${report.shard}: ${report.fetched} fetched, ${report.failed.length} failed, ` +
        `${report.symbols} symbols, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    if (report.failed.length > 0) {
      console.log(`     first failures: ${report.failed.slice(0, 5).join(', ')}`);
    }
  }
}

if (stage === 'gamma' || stage === 'all') {
  const { scanCandidates } = await import('../src/lib/scanner/run.ts');
  const { refreshScannerGamma } = await import('../src/lib/scanner/gamma.ts');
  const { resolveChainSource } = await import('../src/lib/scanner/gammaSource.ts');

  const [{ rows }, source] = await Promise.all([scanCandidates(), resolveChainSource()]);
  const wanted = rows.slice(0, Math.max(1, source.budget - 1));
  console.log(`[gamma] ranked=${rows.length} requesting=${wanted.length} via ${source.primary}`);

  const started = Date.now();
  const outcome = await refreshScannerGamma(
    wanted.map((r) => ({ symbol: r.symbol, close: r.close })),
  );
  console.log(
    `[gamma] refreshed=${outcome.refreshed} failed=${outcome.failed} skipped=${outcome.skipped} ` +
      `in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  console.log(`[gamma] source line: ${outcome.stored.source}`);
}

if (stage === 'scan' || stage === 'all') {
  const { runScanner } = await import('../src/lib/scanner/run.ts');
  const { DEFAULT_FILTERS, scoreAndJudge, buildFunnel } = await import(
    '../src/lib/scanner/score.ts'
  );

  const started = Date.now();
  const result = await runScanner();
  console.log(`[scan] finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log('[scan] coverage:', JSON.stringify(result.coverage, null, 1));

  const market = { spyRegime: result.spyRegime };
  const judged = scoreAndJudge(result.rows, DEFAULT_FILTERS, market);
  const matching = judged.filter((e) => e.passes && !e.earningsExcluded).length;
  const withGamma = result.rows.filter((r) => r.regime !== null).length;

  console.log('');
  console.log('HEADER LINE:');
  console.log(
    `  ${result.scored} scored · ${withGamma} with gamma data · ${matching} match every filter in force`,
  );
  console.log('SUBTITLE:');
  console.log(
    `  ${result.scored} S&P 500 names scored 0-100 and ranked this morning` +
      (result.universe > result.scored
        ? `, out of ${result.universe} in the index — the rest had no usable price history or sit below the ranking engine's turnover floor.`
        : ' — every name in the index.'),
  );
  console.log('FUNNEL:');
  for (const stageRow of buildFunnel(judged, DEFAULT_FILTERS)) {
    console.log(
      `  ${String(stageRow.count).padStart(4)} ${stageRow.label}` +
        (stageRow.untested > 0 ? `  (${stageRow.untested} untested)` : ''),
    );
  }
  console.log('NOTES:');
  for (const note of result.notes) console.log(`  - ${note}`);
}


if (stage === 'track' || stage === 'all') {
  const { logTodaysPicks } = await import('../src/lib/trackRecord/log.ts');
  const { settleTrackRecord } = await import('../src/lib/trackRecord/settle.ts');
  const { readTrackRecord } = await import('../src/lib/trackRecord/store.ts');
  const { summariseTrackRecord } = await import('../src/lib/trackRecord/types.ts');

  const logged = await logTodaysPicks();
  console.log(
    `[track] date=${logged.date} logged=${logged.logged.length} alreadyLogged=${logged.alreadyLogged} ` +
      `closesMissing=${logged.closesMissing.length}`,
  );
  for (const entry of logged.logged) {
    console.log(
      `  ${String(entry.rank)}. ${entry.symbol.padEnd(6)} score ${entry.score.toFixed(1).padStart(5)} ` +
        `close ${entry.close === null ? 'none' : entry.close.toFixed(2)}  (${entry.closeSource})`,
    );
  }
  for (const note of logged.notes) console.log(`  note: ${note}`);

  const settled = await settleTrackRecord();
  console.log(
    `[track] settle considered=${settled.considered} filled=${settled.filled} ` +
      `closesFilled=${settled.closesFilled} failures=${settled.failures.length}`,
  );

  const summary = summariseTrackRecord(await readTrackRecord());
  console.log('[track] summary:', JSON.stringify(summary.byHorizon.d5), 'logged:', summary.logged);
}
