/*
 * Validation of /lab's Strikes tab: the pure pieces in src/lib/tasty/strikes.ts
 * and the live run in strikesRun.ts, driven end to end through the real dxLink
 * client against a fake Tastytrade REST API and a fake dxLink socket.
 *
 * What the run must do: keep only contracts inside the day window and the
 * side toggle, sum each strike across expirations, name the top-OI and
 * top-volume strikes (which can differ), stream one row per ticker, turn a
 * failing ticker into a labelled row instead of failing the run, log the field
 * name when a number never arrives, and read the feed fresh on every run.
 *
 * Run: npm run verify:strikes
 */
import assert from 'node:assert/strict';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

process.env.TASTY_SOURCE = 'live';
process.env.TASTY_CLIENT_SECRET = 'test-secret';
process.env.TASTY_REFRESH_TOKEN = 'test-refresh';
delete process.env.VERCEL_ENV;

const strikes = await import('../src/lib/tasty/strikes.ts');
const { addDays, marketToday } = await import('../src/lib/time.ts');

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log('pure');
await check('ticker list: commas, newlines, spaces, $, dupes, junk', () => {
  const { tickers, rejected } = strikes.parseTickerList('spy, QQQ\n$iwm  BRK.B\nspy;;  12AB, toolongticker1');
  assert.deepEqual(tickers, ['SPY', 'QQQ', 'IWM', 'BRK.B']);
  assert.deepEqual(rejected, ['12AB', 'TOOLONGTICKER1']);
});
await check('window and side inputs fall back to 60 / all', () => {
  assert.equal(strikes.normaliseWindowDays('abc'), 60);
  assert.equal(strikes.normaliseWindowDays(-3), 60);
  assert.equal(strikes.normaliseWindowDays('30.9'), 30);
  assert.equal(strikes.normaliseSide('puts'), 'puts');
  assert.equal(strikes.normaliseSide('both'), 'all');
});
await check('window: expired out, today in during the session, edge day inclusive', () => {
  const morning = new Date('2026-10-28T14:00:00Z'); // Wed 10:00 ET
  assert.equal(strikes.inWindow('2026-10-27', 60, morning), false);
  assert.equal(strikes.inWindow('2026-10-28', 0, morning), true);
  assert.equal(strikes.inWindow('2026-12-27', 60, morning), true);
  assert.equal(strikes.inWindow('2026-12-28', 60, morning), false);
  assert.equal(strikes.inWindow('2026-10-28', 60, new Date('2026-10-28T20:00:00Z')), false); // 16:00 ET
});
await check('topStrikes sums per strike, skips missing, ties to the lower strike', () => {
  const t = strikes.topStrikes([
    { strike: 100, openInterest: 300, volume: null },
    { strike: 100, openInterest: 200, volume: 5 },
    { strike: 90, openInterest: 500, volume: 40 },
    { strike: 110, openInterest: null, volume: 40 },
  ]);
  assert.deepEqual(t.oi, { strike: 90, value: 500 });
  assert.deepEqual(t.volume, { strike: 90, value: 40 });
  assert.deepEqual(strikes.topStrikes([{ strike: 1, openInterest: null, volume: null }]), { oi: null, volume: null });
});
await check('CSV: header, quoting, empty cells for nulls', () => {
  const csv = strikes.rowsToCsv([
    { stock: 'AAA', status: 'ok', topOiStrike: 90, topOi: 700, topVolumeStrike: 90, topVolume: 905, contracts: 4, oiReported: 4, volumeReported: 4, note: null, ms: 1 },
    { stock: 'BAD', status: 'error', topOiStrike: null, topOi: null, topVolumeStrike: null, topVolume: null, contracts: 0, oiReported: 0, volumeReported: 0, note: 'chain answered 500, "retry"', ms: 1 },
  ]);
  assert.equal(
    csv,
    'stock,top_oi_strike,top_oi,top_volume_strike,top_volume,contracts,status,note\r\n' +
      'AAA,90,700,90,905,4,ok,\r\n' +
      'BAD,,,,,0,error,"chain answered 500, ""retry"""\r\n',
  );
});

/* ---------------------------------------------------------------- fakes -- */

const today = marketToday();
const NEAR = addDays(today, 1);
const MID = addDays(today, 20);
const FAR = addDays(today, 200); // outside a 60-day window

const sym = (u, exp, type, strike) => `.${u}${exp.slice(2).replace(/-/g, '')}${type === 'call' ? 'C' : 'P'}${strike}`;

/** Per-underlying contracts: [expiration, type, strike, OI, volume]. */
const BOOKS = {
  AAA: [
    [NEAR, 'call', 100, 500, 10],
    [NEAR, 'put', 90, 400, 900],
    [MID, 'put', 90, 300, 5],
    [MID, 'call', 110, 450, 50],
    [FAR, 'call', 110, 10_000, 10_000],
  ],
  NOVOL: [
    [NEAR, 'call', 20, 70, Number.NaN],
    [NEAR, 'put', 18, 30, Number.NaN],
  ],
};
let runNumber = 1;
const valueOf = new Map();
for (const [u, rows] of Object.entries(BOOKS)) {
  for (const [exp, type, strike, oi, vol] of rows) valueOf.set(sym(u, exp, type, strike), { oi, vol });
}

const calls = { chain: 0 };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/oauth/token')) return Response.json({ access_token: 'acc', expires_in: 900 });
  if (u.endsWith('/api-quote-tokens')) {
    return Response.json({ data: { token: 'stream', 'dxlink-url': 'wss://fake', 'expires-at': new Date(Date.now() + 864e5).toISOString() } });
  }
  const m = u.match(/option-chains\/([^/]+)\/nested/);
  if (m) {
    calls.chain += 1;
    const book = BOOKS[decodeURIComponent(m[1])];
    if (!book) return new Response('{}', { status: 404 });
    const byExp = new Map();
    for (const [exp, type, strike] of book) {
      const e = byExp.get(exp) ?? new Map();
      const s = e.get(strike) ?? { 'strike-price': String(strike) };
      s[type === 'call' ? 'call-streamer-symbol' : 'put-streamer-symbol'] = sym(decodeURIComponent(m[1]), exp, type, strike);
      e.set(strike, s);
      byExp.set(exp, e);
    }
    return Response.json({
      data: { items: [{ expirations: [...byExp].map(([exp, e]) => ({ 'expiration-date': exp, strikes: [...e.values()] })) }] },
    });
  }
  throw new Error(`unexpected fetch ${u}`);
};

const wire = { added: [], removed: [] };
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  constructor() {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 5);
  }
  reply(msg) {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 5);
  }
  send(text) {
    const msg = JSON.parse(text);
    if (msg.type === 'SETUP') this.reply({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
    else if (msg.type === 'AUTH') this.reply({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
    else if (msg.type === 'CHANNEL_REQUEST') this.reply({ type: 'CHANNEL_OPENED', channel: msg.channel });
    else if (msg.type === 'FEED_SUBSCRIPTION') {
      if (msg.remove) wire.removed.push(...msg.remove);
      if (msg.add) {
        wire.added.push(...msg.add);
        const data = msg.add.map(({ type, symbol }) => {
          const v = valueOf.get(symbol);
          return type === 'Summary'
            ? { eventType: 'Summary', eventSymbol: symbol, openInterest: v ? v.oi * runNumber : 'NaN' }
            : { eventType: 'Trade', eventSymbol: symbol, price: 1, size: 1, dayVolume: v && Number.isFinite(v.vol) ? v.vol * runNumber : 'NaN', time: Date.now() };
        });
        this.reply({ type: 'FEED_DATA', channel: msg.channel, data });
      }
    }
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
globalThis.WebSocket = FakeSocket;

const { runStrikes, strikesAvailability } = await import('../src/lib/tasty/strikesRun.ts');
const { dxFeed } = await import('../src/lib/tasty/dxlink.ts');

const warnings = [];
const realWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));

async function run(tickers, windowDays = 60, side = 'all') {
  const rows = [];
  await runStrikes(tickers, { windowDays, side }, (row) => rows.push(row));
  return Object.fromEntries(rows.map((r) => [r.stock, r]));
}

console.log('live run (fake feed)');
await check('availability: runs on the live feed (production too), refused off it', () => {
  assert.deepEqual(strikesAvailability(), { ok: true });
  process.env.VERCEL_ENV = 'production';
  assert.deepEqual(strikesAvailability(), { ok: true });
  delete process.env.VERCEL_ENV;
  process.env.TASTY_SOURCE = 'mock';
  assert.equal(strikesAvailability().ok, false);
  process.env.TASTY_SOURCE = 'live';
});

let first;
await check('All, 60 days: strike 90 tops both; the 200-day contract never counts', async () => {
  first = await run(['AAA', 'BAD', 'NOVOL']);
  assert.equal(first.AAA.status, 'ok');
  assert.equal(first.AAA.contracts, 4);
  assert.equal(first.AAA.topOiStrike, 90);
  assert.equal(first.AAA.topOi, 700);
  assert.equal(first.AAA.topVolumeStrike, 90);
  assert.equal(first.AAA.topVolume, 905);
  assert.equal(first.AAA.note, null);
});
await check('a failing ticker is a labelled row and the run carries on', () => {
  assert.equal(first.BAD.status, 'error');
  assert.match(first.BAD.note, /No option chain/);
  assert.equal(first.NOVOL.status, 'ok');
});
await check('an empty field is logged by the name tried', () => {
  assert.equal(first.NOVOL.topOiStrike, 20);
  assert.equal(first.NOVOL.topVolume, null);
  assert.match(first.NOVOL.note, /Trade\.dayVolume/);
  assert.ok(warnings.some((w) => w.includes('NOVOL') && w.includes('Trade.dayVolume')));
});
await check('Calls only: OI and volume strikes differ', async () => {
  const r = (await run(['AAA'], 60, 'calls')).AAA;
  assert.equal(r.contracts, 2);
  assert.deepEqual([r.topOiStrike, r.topOi, r.topVolumeStrike, r.topVolume], [100, 500, 110, 50]);
});
await check('Puts only, and a 10-day window keeps only the near expiry', async () => {
  const r = (await run(['AAA'], 10, 'puts')).AAA;
  assert.equal(r.contracts, 1);
  assert.deepEqual([r.topOiStrike, r.topOi, r.topVolumeStrike, r.topVolume], [90, 400, 90, 900]);
});
await check('a second run re-fetches the chain and reads the new numbers', async () => {
  const before = calls.chain;
  runNumber = 2;
  const r = (await run(['AAA'])).AAA;
  assert.equal(calls.chain, before + 1);
  assert.equal(r.topOi, 1400);
  assert.equal(r.topVolume, 1810);
});
await check('subscriptions the run added are released, and their events dropped', () => {
  const symbols = [...valueOf.keys()];
  const feed = dxFeed();
  assert.ok(symbols.every((s) => !feed.states.has(s)));
  const addedCount = wire.added.length;
  assert.ok(addedCount > 0);
  assert.equal(wire.removed.length, addedCount);
});

console.warn = realWarn;
console.log(`\n${passed} checks passed`);
process.exit(0);
