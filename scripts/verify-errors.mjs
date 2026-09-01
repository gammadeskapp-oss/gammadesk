/*
 * Validation that user-facing failure text says nothing about internals.
 *
 * Why this file exists: the error screen a visitor hits is the surface where
 * internal detail leaks most easily, because the person writing it is usually
 * the person debugging it. The first version of this app's error card printed
 * environment variable names and advice about which provider plan includes
 * which endpoint — a note to an operator, shown to a reader who could not act
 * on it and had not asked.
 *
 * The fix was to split the two: adapters keep writing precise technical
 * messages for the logs, and every page renders `ChainError.publicMessage`
 * instead. That split only holds if something checks it, because the failure
 * mode is silent — a reworded adapter message leaks the moment a page reaches
 * for `.message` again.
 *
 * So this walks every status an adapter actually throws and asserts the public
 * text names no provider, no credential, no HTTP code, and no plan.
 *
 * Run: npm run verify:errors
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

/*
 * The pure mapping, not the class. `chainSource.ts` uses TypeScript parameter
 * properties, which Node's type-stripping loader cannot parse — and pulling in
 * the whole chain module to test a status-to-sentence table would be the wrong
 * dependency anyway.
 */
const { publicChainMessage } = await import('../src/lib/errorText.ts');

/** Stands in for `new ChainError(...).publicMessage`, which delegates here. */
const ChainError = class {
  constructor(message, status, hint) {
    this.message = message;
    this.status = status;
    this.hint = hint;
  }
  get publicMessage() {
    return publicChainMessage(this.status);
  }
};

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

/**
 * The statuses the adapters really produce.
 *
 * 0 is a request that never completed, 403/404 a symbol the provider does not
 * publish, 200 a response that arrived and carried nothing usable, 5xx the
 * provider itself being unwell.
 */
const STATUSES = [0, 200, 400, 401, 403, 404, 429, 500, 502, 503];

/** Real messages from cboe.ts and polygon.ts, verbatim. */
const TECHNICAL = [
  ['Could not reach the Cboe delayed-quote service.', 0],
  ['Cboe returned HTTP 403 for SPY.', 403],
  ['Cboe returned HTTP 500.', 500],
  ['Cboe returned no underlying price for SPY.', 200],
  ['Cboe returned no SPY option contracts.', 200],
  ['No usable SPY contracts after filtering.', 200],
  ['Polygon returned HTTP 429.', 429],
  ['Polygon returned no SPY option contracts.', 200],
  ['The market data provider is not configured.', 0],
];

// --- nothing internal reaches the reader -------------------------------------

section('Public messages name no internals');

/*
 * Whole words and specific strings, not loose substrings. The point is to ban
 * the disclosure, not the vocabulary — "data" is fine, "POLYGON_API_KEY" is
 * not.
 */
const FORBIDDEN = [
  [/\bcboe\b/i, 'the provider name'],
  [/\bpolygon\b/i, 'the provider name'],
  [/\btradier\b/i, 'the provider name'],
  [/\bvercel\b/i, 'the host'],
  [/[A-Z][A-Z0-9]*_[A-Z0-9_]+/, 'an environment variable name'],
  [/\bhttp\b/i, 'the protocol'],
  [/\b[45]\d{2}\b/, 'an HTTP status code'],
  [/\bapi[ _-]?key\b/i, 'a credential'],
  [/\btoken\b/i, 'a credential'],
  [/\bfree[ -]plan\b/i, 'a pricing plan'],
  [/\bplan\b/i, 'a pricing plan'],
  [/\bendpoint\b/i, 'an internal term'],
  [/\bCDN\b/, 'an internal term'],
  [/\.env/i, 'a config file'],
  [/\benvironment variable\b/i, 'a config mechanism'],
];

for (const status of STATUSES) {
  const error = new ChainError(
    `Cboe returned HTTP ${status} for SPY via the CDN; check POLYGON_API_KEY and the free plan.`,
    status,
    'Add it to .env.local and to Project Settings -> Environment Variables.',
  );

  const text = error.publicMessage;

  ok(`status ${status} produces a sentence`, text.length > 15, text);
  ok(`status ${status} ends in a full stop`, text.trim().endsWith('.'), text);

  for (const [pattern, what] of FORBIDDEN) {
    ok(`status ${status} does not disclose ${what}`, !pattern.test(text), text);
  }
}

section('Every real adapter message is sanitised');

for (const [message, status] of TECHNICAL) {
  const text = new ChainError(message, status).publicMessage;
  ok(
    `"${message.slice(0, 34)}…" is not passed through`,
    text !== message,
    text,
  );
  for (const [pattern, what] of FORBIDDEN) {
    ok(`…and discloses no ${what}`, !pattern.test(text), text);
  }
}

// --- the technical detail is still there for the logs ------------------------

section('The technical message survives for the logs');

const detailed = new ChainError('Cboe returned HTTP 503.', 503, 'CDN refusing.');
ok('message is untouched', detailed.message === 'Cboe returned HTTP 503.');
ok('hint is untouched', detailed.hint === 'CDN refusing.');
ok('status is untouched', detailed.status === 503);
ok(
  'and the public text differs from it',
  detailed.publicMessage !== detailed.message,
);

// --- the wording distinguishes the cases a reader can act on -----------------

section('An outage, an unlisted ticker and a refusal read differently');

const outage = new ChainError('x', 0).publicMessage;
const unwell = new ChainError('x', 503).publicMessage;
const missing = new ChainError('x', 404).publicMessage;

ok('a dead request and a sick provider read the same', outage === unwell, `${outage} / ${unwell}`);
ok(
  'neither blames the ticker',
  !/ticker|symbol/i.test(outage),
  outage,
  );
ok('an unlisted ticker says so', /ticker/i.test(missing), missing);
ok('and is not confused with an outage', missing !== outage);

/*
 * Being refused for volume is a third state, and the one most easily mistaken
 * for the second. A reader who is told their ticker has no options published,
 * when the truth is that the allowance ran out a moment ago, has been told
 * something false about the market rather than merely something unhelpful.
 */
const busy = new ChainError('x', 429).publicMessage;
const unusable = new ChainError('x', 200).publicMessage;

ok('being rate limited reads as its own state', busy !== missing && busy !== unusable && busy !== outage, busy);
ok('and does not claim the ticker has nothing listed', !/no options|not published|isn't available/i.test(busy), busy);
ok('and says the wait is temporary', /wait|moment|again/i.test(busy), busy);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
