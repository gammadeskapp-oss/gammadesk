/*
 * How long one chain actually costs, and where the time goes.
 *
 * A whole-universe gamma refresh has to average well under a second a symbol
 * to fit inside a five-minute function, so "it works" is not the question —
 * "how fast, and which part" is. This times the fetch and the exposure maths
 * separately, and counts upstream requests, for a handful of representative
 * symbols.
 *
 * Read-only apart from the upstream calls it makes.
 *
 * Run: node --conditions=react-server --experimental-transform-types \
 *        scripts/probe-chain-cost.mjs [SYMBOL ...]
 */

import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

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
        // Neither.
      }
    }
  }
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOK)}`, import.meta.url);

const { fetchPolygonChain } = await import('../src/lib/polygon.ts');
const { buildPositioning } = await import('../src/lib/exposure.ts');
const { config } = await import('../src/lib/config.ts');

const symbols = process.argv.slice(2);
const targets = symbols.length > 0 ? symbols : ['SPY', 'AAPL', 'NVDA', 'F', 'DPZ'];

for (const symbol of targets) {
  try {
    const t0 = Date.now();
    const snapshot = await fetchPolygonChain(symbol);
    const t1 = Date.now();

    buildPositioning(snapshot.contracts, {
      symbol,
      spot: snapshot.spot,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      expirationCount: config.expirationCount,
      strikesEachSide: config.strikesEachSide,
      meta: {
        source: 'polygon',
        sourceLabel: '',
        asOfLabel: '',
        asOfIso: new Date().toISOString(),
        quoteDateLabel: '',
        quoteDateIso: snapshot.quoteDate.toISOString(),
        cacheSeconds: 0,
        upstreamRequests: snapshot.requests,
        riskFreeRate: config.riskFreeRate,
        dividendYield: config.dividendYield,
        notes: [],
      },
    });
    const t2 = Date.now();

    console.log(
      `${symbol.padEnd(6)} fetch ${String(t1 - t0).padStart(6)}ms  ` +
        `exposure ${String(t2 - t1).padStart(5)}ms  ` +
        `requests ${String(snapshot.requests).padStart(3)}  ` +
        `contracts ${String(snapshot.contracts.length).padStart(5)}`,
    );
  } catch (error) {
    console.log(`${symbol.padEnd(6)} FAILED: ${error instanceof Error ? error.message : error}`);
  }
}
