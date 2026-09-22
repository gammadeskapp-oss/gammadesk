/*
 * The pure logic behind the news scanner: how 8-K item codes become categories,
 * how a category is tiered and put into plain English, how items are scored and
 * ranked, when the scan window is open, and the feed/display parsers. These are
 * the parts a wrong change would break silently — a market-mover mis-scored, a
 * boilerplate filing surfaced, a headline that copies source text, or a scan
 * that drifts off its Central-time window across DST.
 *
 * The IO-bound pieces (EDGAR/Polygon/press fetches, the Blob store) import
 * `server-only` and are exercised by the live route, not here.
 *
 * Run: npm run verify:news
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { categoryForItems, CATEGORY_TIER, plainEnglish, CATEGORY_LABEL } = await import(
  '../src/lib/news/headline.ts'
);
const { scoreItem, categoryForKeywords, isRankable, topCount } = await import('../src/lib/news/score.ts');
const { scanWindow, WINDOW_START_MIN, WINDOW_END_MIN } = await import('../src/lib/news/schedule.ts');
const { relativeTime, storyLabel, hasMoving, xLine, SOURCE_LABEL } = await import('../src/lib/news/view.ts');
const { rankItems } = await import('../src/lib/news/scan-core.ts');
const { sizeTierFor } = await import('../src/lib/news/universe.ts');
const { parseDisplayName, filingUrl, parseFeedItems, tickerFromTitle } = await import('../src/lib/news/parse.ts');
const { shortName, isHealthcare } = await import('../src/lib/news/industry.ts');
const { extractStory, cleanFilingText } = await import('../src/lib/news/extract.ts');

let failures = 0;
let checks = 0;
function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
function section(name) {
  console.log(`\n${name}`);
}

// The wording rules the X guard enforces — headlines must never trip them.
const BANNED = [
  /\b(buy|buys|buying|bought)\b/i,
  /\b(sell|sells|selling|sold)\b/i,
  /\b(go|going)\s+(long|short)\b/i,
  /\b(trade|trades|trading|traders?)\b/i,
  /\b(calls?|puts?)\b/i,
  /\b(entry|entries|exit|exits|stop[- ]?loss|take[- ]?profit|price target)\b/i,
];

section('categoryForItems maps 8-K item codes to the right category');
ok('1.01 → M&A', categoryForItems(['1.01']) === 'ma');
ok('1.03 → bankruptcy', categoryForItems(['1.03']) === 'bankruptcy');
ok('5.02 → leadership', categoryForItems(['5.02']) === 'leadership');
ok('2.02 → earnings', categoryForItems(['2.02']) === 'earnings');
ok('3.01 → delisting', categoryForItems(['3.01']) === 'delisting');
ok('4.02 → restatement', categoryForItems(['4.02']) === 'restatement');
ok('unknown code → other', categoryForItems(['9.01']) === 'other');
ok('empty → other', categoryForItems([]) === 'other');
ok(
  'most material item wins (earnings + CEO change → leadership)',
  categoryForItems(['2.02', '5.02']) === 'leadership',
);
ok(
  'bankruptcy outranks a deal in the same filing',
  categoryForItems(['1.01', '1.03']) === 'bankruptcy',
);

section('CATEGORY_TIER matches the brief’s High / Medium / Ignore buckets');
for (const cat of ['ma', 'guidance', 'bankruptcy', 'delisting', 'leadership', 'buyback', 'regulatory', 'fda', 'restatement', 'deal']) {
  ok(`${cat} is High`, CATEGORY_TIER[cat] === 'high');
}
for (const cat of ['product', 'partnership', 'insider']) {
  ok(`${cat} is Medium`, CATEGORY_TIER[cat] === 'medium');
}
ok('earnings is Ignore', CATEGORY_TIER.earnings === 'ignore');
ok('other is Ignore', CATEGORY_TIER.other === 'ignore');

section('plainEnglish rewrites in our own words and never uses banned wording');
{
  const cats = Object.keys(CATEGORY_LABEL);
  for (const cat of cats) {
    const { headline, why } = plainEnglish(cat, 'Example Corp', 'EXMP');
    const text = `${headline} ${why}`;
    ok(`${cat} headline mentions the subject`, headline.includes('EXMP') || headline.includes('Example Corp'));
    ok(`${cat} has a non-empty why`, typeof why === 'string' && why.length > 10);
    for (const re of BANNED) {
      ok(`${cat} avoids banned wording ${re}`, !re.test(text), `${text}`);
    }
  }
  // No ticker → falls back to the company name, never empty.
  const noTicker = plainEnglish('ma', 'Some Company', null);
  ok('no-ticker headline uses the company name', noTicker.headline.includes('Some Company'));
}

section('scoreItem: category, size and unusualness combine as the brief asks');
{
  const megaMA = scoreItem({ category: 'ma', sizeTier: 'mega' }).score;
  const otherMA = scoreItem({ category: 'ma', sizeTier: 'other' }).score;
  ok('a mega-cap deal outscores a tiny-cap deal', megaMA > otherMA, `${megaMA} vs ${otherMA}`);

  const bankruptcy = scoreItem({ category: 'bankruptcy', sizeTier: 'large' }).score;
  const buyback = scoreItem({ category: 'buyback', sizeTier: 'large' }).score;
  ok('bankruptcy outranks a buyback at equal size', bankruptcy > buyback, `${bankruptcy} vs ${buyback}`);

  const plain = scoreItem({ category: 'ma', sizeTier: 'mega' }).score;
  const corrob = scoreItem({ category: 'ma', sizeTier: 'mega', corroborated: true }).score;
  ok('corroboration lifts the score ~10%', corrob > plain && corrob <= plain * 1.11, `${corrob} vs ${plain}`);

  ok('earnings is ignore-tier', scoreItem({ category: 'earnings', sizeTier: 'mega' }).tier === 'ignore');
  ok('a High category is high-tier', scoreItem({ category: 'ma', sizeTier: 'mega' }).tier === 'high');

  const watchName = scoreItem({ category: 'ma', sizeTier: 'watch' }).score;
  ok('a watchlist name outscores background', watchName > otherMA, `${watchName} vs ${otherMA}`);
}

section('isRankable drops ignore-tier and zero-score items');
ok('ignore tier is not rankable', isRankable('ignore', 50) === false);
ok('high tier with score is rankable', isRankable('high', 50) === true);
ok('zero score is not rankable', isRankable('high', 0) === false);

section('topCount surfaces 3–5');
ok('2 available → 2', topCount(2) === 2);
ok('3 available → 3', topCount(3) === 3);
ok('4 available → 4', topCount(4) === 4);
ok('9 available → capped at 5', topCount(9) === 5);
ok('0 available → 0', topCount(0) === 0);

section('categoryForKeywords classifies free text without copying it');
ok('"merger" → ma', categoryForKeywords('Foo announces merger with Bar') === 'ma');
ok('"files for chapter 11" → bankruptcy', categoryForKeywords('Foo files for Chapter 11') === 'bankruptcy');
ok('"cuts guidance" → guidance', categoryForKeywords('Foo cuts full-year guidance') === 'guidance');
ok('"$2B buyback" → buyback', categoryForKeywords('Board approves $2B buyback') === 'buyback');
ok('nothing recognisable → other', categoryForKeywords('Foo attends a conference') === 'other');

section('scanWindow gates on the America/Chicago clock, DST-safe');
{
  // A summer weekday at 09:00 CT = 14:00 UTC → open.
  const summerOpen = scanWindow(new Date('2026-07-01T14:00:00Z'));
  ok('summer 09:00 CT is open', summerOpen.open === true, summerOpen.reason);
  // A winter weekday at 09:00 CT = 15:00 UTC → open.
  const winterOpen = scanWindow(new Date('2026-01-05T15:00:00Z'));
  ok('winter 09:00 CT is open', winterOpen.open === true, winterOpen.reason);
  // 05:00 CT (before the window) → closed.
  const early = scanWindow(new Date('2026-07-01T10:00:00Z'));
  ok('05:00 CT is closed', early.open === false);
  // 16:00 CT (after 15:30) → closed.
  const late = scanWindow(new Date('2026-07-01T21:00:00Z'));
  ok('16:00 CT is closed', late.open === false);
  // Saturday inside window hours → closed (weekend).
  const weekend = scanWindow(new Date('2026-07-04T16:00:00Z'));
  ok('Saturday is closed', weekend.open === false, weekend.reason);
  ok('window bounds are 06:00 and 15:30', WINDOW_START_MIN === 360 && WINDOW_END_MIN === 930);
}

section('view helpers');
ok('relativeTime: minutes', relativeTime('2026-09-20T12:00:00Z', new Date('2026-09-20T12:30:00Z')) === '30m ago');
ok('relativeTime: hours', relativeTime('2026-09-20T09:00:00Z', new Date('2026-09-20T12:00:00Z')) === '3h ago');
ok('relativeTime: bad input → null', relativeTime('nope') === null);
ok('storyLabel prefers ticker', storyLabel({ ticker: 'AAPL', company: 'Apple' }) === 'AAPL');
ok('storyLabel falls back to company', storyLabel({ ticker: null, company: 'Some Co' }) === 'Some Co');
ok('hasMoving false on empty', hasMoving([]) === false && hasMoving(null) === false);
ok('hasMoving true with items', hasMoving([{}]) === true);
ok('every source has a label', ['edgar', 'polygon', 'press'].every((s) => typeof SOURCE_LABEL[s] === 'string'));
{
  const line = xLine({ ticker: 'KO', company: 'Coca-Cola', headline: 'Coca-Cola raised its full-year guidance' });
  ok('xLine leads with the ticker and drops the name', line === 'KO: raised its full-year guidance', line);
  const poss = xLine({ ticker: 'WMT', company: 'Walmart', headline: "Walmart's CEO is departing" });
  ok('xLine strips a possessive company prefix', poss === 'WMT: CEO is departing', poss);
  for (const re of BANNED) ok(`xLine avoids ${re}`, !re.test(line), line);
}

section('sizeTierFor tiers by universe membership');
{
  const watch = new Set(['ZZZZ']);
  ok('AAPL is mega', sizeTierFor('AAPL', watch) === 'mega');
  ok('ADBE is large', sizeTierFor('ADBE', watch) === 'large');
  ok('a watchlist-only name is watch', sizeTierFor('ZZZZ', watch) === 'watch');
  ok('an unknown name is other', sizeTierFor('WXYZ', watch) === 'other');
  ok('null ticker is other', sizeTierFor(null, watch) === 'other');
}

section('rankItems surfaces only enriched items, dedupes and ranks');
{
  const watch = new Set();
  const enrich = (category, company, headline, magnitude) => ({ category, company, headline, why: `${company} why line.`, magnitude });
  const raw = [
    { source: 'edgar', ticker: 'AAPL', company: 'Apple Inc.', category: 'ma', timestamp: '2026-09-20T14:00:00Z', url: 'u1', signals: {}, enrichment: enrich('ma', 'Apple', 'Apple agreed to acquire NewCo for $5 billion', 0.9) },
    // Second, weaker source names AAPL too — no enrichment, but corroborates.
    { source: 'polygon', ticker: 'AAPL', company: 'AAPL', category: 'ma', timestamp: '2026-09-20T13:00:00Z', url: 'u2', signals: {} },
    { source: 'edgar', ticker: 'MSFT', company: 'Microsoft', category: 'buyback', timestamp: '2026-09-20T12:00:00Z', url: 'u3', signals: {}, enrichment: enrich('buyback', 'Microsoft', 'Microsoft authorized a $10 billion share buyback', 0.6) },
    // Un-enriched EDGAR item (text unreadable) — must be dropped, never shown.
    { source: 'edgar', ticker: 'XOM', company: 'Exxon', category: 'ma', timestamp: '2026-09-20T11:00:00Z', url: 'u4', signals: {} },
    { source: 'edgar', ticker: 'WMT', company: 'Walmart', category: 'leadership', timestamp: '2026-09-20T10:00:00Z', url: 'u5', signals: {}, enrichment: enrich('leadership', 'Walmart', "Walmart's CEO is departing", 0.8) },
  ];
  const { top, ranked } = rankItems(raw, watch);
  ok('un-enriched item is dropped', !ranked.some((r) => r.ticker === 'XOM'), JSON.stringify(ranked.map((r) => r.ticker)));
  ok('AAPL surfaces one row', ranked.filter((r) => r.ticker === 'AAPL').length === 1);
  ok('AAPL kept the EDGAR source', ranked.find((r) => r.ticker === 'AAPL')?.source === 'edgar');
  ok('AAPL ranks first (mega deal + corroborated + magnitude)', ranked[0]?.ticker === 'AAPL', ranked[0]?.ticker);
  ok('AAPL headline names the company once', ranked[0]?.headline === 'Apple agreed to acquire NewCo for $5 billion', ranked[0]?.headline);
  ok('three enriched rows survive', ranked.length === 3, String(ranked.length));
  ok('top surfaces all three', top.length === 3);
  ok('every picked story has headline + why', top.every((s) => s.headline && s.why));
}

section('EDGAR display-name and URL parsing');
ok(
  'ticker pulled from display name',
  JSON.stringify(parseDisplayName('APPLE INC. (AAPL) (CIK 0000320193)')) ===
    JSON.stringify({ company: 'APPLE INC.', ticker: 'AAPL' }),
);
ok('no ticker when only a CIK is present', parseDisplayName('SOME TRUST (CIK 0001234567)').ticker === null);
ok(
  'filingUrl builds the archive index path',
  filingUrl('0001193125-20-236322', '0000320193') ===
    'https://www.sec.gov/Archives/edgar/data/320193/000119312520236322/0001193125-20-236322-index.htm',
);
ok('filingUrl degrades without an accession', filingUrl(undefined, '320193').includes('sec.gov'));

section('feed parsing and press ticker extraction');
{
  const rss = `<rss><channel>
    <item><title>Acme Corp (NASDAQ: ACME) announces merger</title><link>https://ex.com/a</link><pubDate>Mon, 20 Sep 2026 12:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Beta Inc launches a product]]></title><link>https://ex.com/b</link></item>
  </channel></rss>`;
  const items = parseFeedItems(rss);
  ok('two feed items parsed', items.length === 2, String(items.length));
  ok('CDATA title decoded', items[1].title === 'Beta Inc launches a product');
  ok('link extracted', items[0].link === 'https://ex.com/a');

  const universe = new Set(['ACME', 'BETA']);
  ok('ticker from "(NASDAQ: ACME)"', tickerFromTitle('Acme Corp (NASDAQ: ACME) announces merger', universe) === 'ACME');
  ok('no ticker when none in universe', tickerFromTitle('Nobody Inc does something', universe) === null);
}

section('industry: friendly names and the FDA gate');
ok('shortName uses the curated map', shortName('Meta Platforms, Inc.', 'META') === 'Meta');
ok('shortName strips corporate suffixes', shortName('Some Widget Holdings Inc.', 'SWH') === 'Some Widget');
ok('shortName drops a leading "The"', shortName('The Coca-Cola Company', 'KO') === 'Coca-Cola');
ok('shortName falls back to ticker when name == ticker', shortName('ZZZ', 'ZZZ') === 'ZZZ');
ok('healthcare gate: LLY is healthcare', isHealthcare('LLY') === true);
ok('healthcare gate: META is not', isHealthcare('META') === false);

section('extractStory reads real text into a specific headline');
{
  const base = { itemCodes: [], itemCategory: 'other', ticker: 'X', isHealthcare: false };
  const g = extractStory({ ...base, company: 'Coca-Cola', text: 'The Company raised its full-year revenue guidance and now sees revenue of $46 billion for fiscal 2026.' });
  ok('guidance direction + number', g && /Coca-Cola raised its full-year revenue guidance to \$46 billion/.test(g.headline), g && g.headline);
  ok('guidance category confirmed', g && g.category === 'guidance');

  const m = extractStory({ ...base, company: 'Acme', text: 'Acme entered into a definitive agreement to acquire Beacon Systems for $3.2 billion in cash.' });
  ok('M&A names the target and value', m && /Acme agreed to acquire Beacon Systems for \$3.2 billion/.test(m.headline), m && m.headline);

  const l = extractStory({ ...base, itemCodes: ['5.02'], company: 'Widget', text: 'Widget announced that its Chief Executive Officer, Jane Roe, will step down effective next month.' });
  ok('leadership names the role', l && /Widget's CEO/.test(l.headline), l && l.headline);
  ok('leadership category', l && l.category === 'leadership');
  // A leadership event with no 5.02 item code is not trusted as leadership.
  ok('leadership needs item 5.02', extractStory({ ...base, company: 'Widget', text: 'Our Chief Executive Officer discussed strategy at a conference.' }) === null);

  const vague = extractStory({ ...base, company: 'Vague', text: 'The registrant filed this report to furnish an investor presentation under Regulation FD. Nothing material.' });
  ok('a vague filing yields null (dropped)', vague === null);

  // FDA gate: identical text, non-healthcare vs healthcare.
  const fdaText = 'The company announced that the FDA approved its new therapy following a successful Phase 3 clinical trial.';
  ok('non-healthcare never gets FDA', extractStory({ ...base, company: 'Meta', ticker: 'META', text: fdaText })?.category !== 'fda');
  const drug = extractStory({ ...base, company: 'Eli Lilly', ticker: 'LLY', isHealthcare: true, text: fdaText });
  ok('healthcare FDA approval surfaces', drug && drug.category === 'fda' && /Eli Lilly won FDA approval/.test(drug.headline), drug && drug.headline);

  // No copied source text and no trading language in any generated headline.
  for (const s of [g, m, l, drug]) {
    if (!s) continue;
    for (const re of BANNED) ok(`extract headline avoids ${re}`, !re.test(s.headline), s.headline);
  }
}

section('cleanFilingText strips tags and decodes entities');
{
  const txt = cleanFilingText('<html><body><p>Acme &amp; Co. raised&nbsp;guidance</p><script>bad()</script></body></html>');
  ok('tags removed', !/[<>]/.test(txt), txt);
  ok('entities decoded and script dropped', txt === 'Acme & Co. raised guidance', txt);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
