/*
 * A read-only count of what the scanner would score right now.
 *
 * Prints the same figures the run's log line prints — the universe, how many
 * names the relative-strength engine can rank, the two reasons a name is not
 * ranked, and the coverage each scoring component would have. It writes
 * nothing anywhere, so it is safe to point at production storage at any hour,
 * and it answers "why is the header showing that number" without spending a
 * scan to find out.
 *
 * Run: node scripts/probe-coverage.mjs
 *
 * Reads `.env.local` itself so it can be run against whichever store that
 * file points at.
 */

import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

// --- env ---------------------------------------------------------------------

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
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
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

/*
 * `.env.local` carries `VERCEL=1` so the local file fallback writes where the
 * platform would. This is a script rather than a function, and leaving it set
 * would point the fallback at /tmp — which is not where anything lives.
 */
delete process.env.VERCEL;

// --- the loader --------------------------------------------------------------

/*
 * The shared `ts-imports` loader maps extensionless relative imports to `.ts`
 * but not directory imports (`from '../groups'`), which the library code uses
 * freely and Next resolves for itself. This adds that one case; everything
 * else falls through to the default resolver unchanged.
 */
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

// --- the probe ---------------------------------------------------------------

const { storeStatus } = await import('../src/lib/jsonStore.ts');
const { getRsResult } = await import('../src/lib/rs/index.ts');
const { DEFAULT_WEIGHTS, DEFAULT_MIN_DOLLAR_VOLUME } = await import(
  '../src/lib/rs/types.ts'
);
const { readMovingAverages } = await import('../src/lib/scanner/averages.ts');
const { peekScannerGamma, readLatestScan } = await import('../src/lib/scanner/index.ts');
const { resolveChainSource } = await import('../src/lib/scanner/gammaSource.ts');

console.log('store:', JSON.stringify(storeStatus()));

const rs = await getRsResult(DEFAULT_WEIGHTS, DEFAULT_MIN_DOLLAR_VOLUME);
console.log('\n--- relative strength (what enters scoring) ---');
console.log({
  universe: rs.universe,
  ranked: rs.ranked,
  wouldEnterScoring: rs.rows.length,
  removedByTurnoverFloor: rs.illiquid,
  noPriceHistoryYet: rs.pending,
  floorDollars: rs.minDollarVolume,
  asOfDate: rs.asOfDate,
  oldestShardDate: rs.oldestShardDate,
});
for (const note of rs.notes) console.log('  note:', note);

const averages = await readMovingAverages();
const values = [...averages.bySymbol.values()];
console.log('\n--- component coverage available from storage ---');
console.log({
  symbolsWithAverages: averages.bySymbol.size,
  withEma200: values.filter((v) => v.ema200 !== null).length,
  withEma50: values.filter((v) => v.ema50 !== null).length,
  withVwap20: values.filter((v) => v.vwap20 !== null).length,
});

const gamma = await peekScannerGamma();
console.log('\n--- stored gamma document ---');
console.log(
  gamma
    ? {
        date: gamma.date,
        symbols: Object.keys(gamma.symbols).length,
        source: gamma.source ?? '(not recorded)',
        byProvider: gamma.byProvider ?? '(not recorded)',
        failures: gamma.failures.length,
        skipped: gamma.skipped.length,
      }
    : '(nothing stored)',
);

console.log('\n--- chain source this run would use ---');
console.log(await resolveChainSource());

const scan = await readLatestScan();
console.log('\n--- latest stored scan ---');
console.log(
  scan
    ? {
        date: scan.date,
        scored: scan.scored,
        universe: scan.universe,
        withGamma: scan.rows.filter((r) => r.regime !== null).length,
        coverage: scan.coverage ?? '(not recorded — stored before coverage existed)',
      }
    : '(nothing stored)',
);
