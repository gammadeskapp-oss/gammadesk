import type { PosterData, PosterKind } from './types';

/**
 * Realistic sample payloads, modelled on the Discord posters. Used by the admin
 * preview (so the design can be checked before real data flows) and as the
 * worked example in the Cowork integration doc. Not used in production posting.
 */

const MORNING: PosterData = {
  kind: 'morning',
  date: '2026-10-05',
  title: 'The Morning Desk',
  subtitle: 'Pre-market briefing · U.S. equities',
  dateLabel: 'Monday, Oct 5 2026',
  asOfLabel: 'as of 7:53 AM CT · cash open 8:30 AM CT',
  snapshot: [
    { symbol: 'SPY', price: 769.26, sub: 'pre-open' },
    { symbol: 'QQQ', price: 749.58, sub: 'pre-open' },
    { symbol: 'DIA', price: 511.1, sub: 'pre-open' },
    { symbol: 'IWM', price: 281.52, sub: 'pre-open' },
    { symbol: 'VIX', price: 16.16, changePct: 5.56, sub: 'index level' },
  ],
  vixSwing: {
    vix: 16.16,
    expectedSwingPct: 0.9,
    caption:
      'VIX up 5.6% pre-open to 16.16, just inside the "watch" band — a modest pickup in hedging demand, not stress.',
  },
  news: [
    { text: 'September ISM services at 8:45 CT; consensus looks for a small cooling from last month.', tag: 'Macro' },
    { text: 'Fed speakers on the tape midday; market pricing one more cut into year-end.', tag: 'Fed' },
    { text: 'Energy bid pre-open as crude firms on supply headlines.', tag: 'Sector' },
  ],
  mostTalked: [
    { name: 'NVDA', mentions: 128 },
    { name: 'TSLA', mentions: 96 },
    { name: 'AAPL', mentions: 71 },
    { name: 'AMD', mentions: 54 },
  ],
  sectors: [
    { name: 'Energy', changePct: 0.8 },
    { name: 'Tech', changePct: 0.3 },
    { name: 'Financials', changePct: 0.1 },
    { name: 'Utilities', changePct: -0.4 },
  ],
  movers: {
    gainers: [
      { symbol: 'AMD', changePct: 2.1 },
      { symbol: 'NVDA', changePct: 1.6 },
      { symbol: 'XOM', changePct: 1.2 },
    ],
    losers: [
      { symbol: 'DIA', changePct: -0.3 },
      { symbol: 'KO', changePct: -0.5 },
      { symbol: 'PG', changePct: -0.6 },
    ],
  },
  earnings: [
    { name: 'Constellation', ticker: 'STZ', when: 'BMO' },
    { name: 'McCormick', ticker: 'MKC', when: 'BMO' },
  ],
  congress: [
    { name: 'Tesla', ticker: 'TSLA', trades: 557 },
    { name: 'Microsoft', ticker: 'MSFT', trades: 499 },
    { name: 'Alphabet', ticker: 'GOOGL', trades: 376 },
    { name: 'Nvidia', ticker: 'NVDA', trades: 312 },
    { name: 'Apple', ticker: 'AAPL', trades: 279 },
  ],
  footer: { left: 'Quotes: delayed ~15 min · gammadesk.app', right: 'Not investment advice' },
};

const CLOSING: PosterData = {
  kind: 'closing',
  date: '2026-10-02',
  title: 'The Closing Bell',
  subtitle: 'End-of-day wrap · U.S. equities',
  dateLabel: 'Friday, Oct 2 2026',
  asOfLabel: 'near the close · cash close 3:00 PM CT',
  snapshot: [
    { symbol: 'SPY', price: 769.36, changePct: 0.74, sub: 'cash close' },
    { symbol: 'QQQ', price: 748.98, changePct: 0.69, sub: 'cash close' },
    { symbol: 'DIA', price: 511.88, changePct: 0.55, sub: 'cash close' },
    { symbol: 'IWM', price: 281.28, changePct: 0.4, sub: 'cash close' },
    { symbol: 'VIX', price: 15.47, changePct: -3.5, sub: 'index level' },
  ],
  story: {
    headline: 'Weak September jobs report takes the Fed’s October hike off the table',
    points: [
      'The September jobs report missed badly: nonfarm payrolls rose just 28,000 versus the ~75,000 consensus.',
      'The BLS also revised down the prior two months by a combined 60,000; hourly earnings rose only 0.1% on the month.',
      'The timing stays in the Fed’s favour: a softer labour market lowers the bar to cutting again this cycle.',
      'Markets read the miss as taking a follow-up hike off the table; the "bad news is good news" dynamic is alive, with stocks higher even though the data itself points to a cooling economy.',
      'Nike also stayed in focus, down ~3.5% today, extending a soft stretch since the quarter-over-quarter estimate miss.',
    ],
  },
  crossAsset: [
    { name: '10Y Treasury', tag: '-6bp', note: 'Yields slid as rate-cut odds reset lower; the long end led the rally.' },
    { name: 'Oil (USO)', tag: '-1.48%', note: 'Crude gave back the week’s gains on softer demand signals.' },
    { name: 'US Dollar (DXY)', tag: '-0.45%', note: 'Dollar softened as the cut path steepened.' },
    { name: 'Bitcoin (BTC)', tag: '+1.4%', note: 'Risk proxy firmed with equities into the close.' },
  ],
  movers: {
    gainers: [
      { symbol: 'TSLA', changePct: 4.42 },
      { symbol: 'ORCL', changePct: 3.22 },
      { symbol: 'GOOGL', changePct: 3.13 },
      { symbol: 'AMZN', changePct: 1.29 },
    ],
    losers: [
      { symbol: 'NKE', changePct: -3.52 },
      { symbol: 'CVX', changePct: -2.25 },
      { symbol: 'XOM', changePct: -1.85 },
      { symbol: 'PLTR', changePct: -1.43 },
    ],
  },
  strategists:
    'Desk strategists read the print as cover for a pause rather than a growth scare: with payrolls this soft, the October hike is off the table and the November cut back in play. Positioning stays constructive into year-end while breadth holds.',
  tomorrow: { label: 'MON, OCT 5', items: ['Factory orders (Aug) — possible Monday release', 'Fed speakers midday', 'ISM services'] },
  congress: [
    { name: 'Microsoft', ticker: 'MSFT', trades: 499 },
    { name: 'Alphabet', ticker: 'GOOGL', trades: 376 },
    { name: 'Nvidia', ticker: 'NVDA', trades: 312 },
    { name: 'Apple', ticker: 'AAPL', trades: 248 },
    { name: 'Amazon', ticker: 'AMZN', trades: 221 },
  ],
  footer: { left: 'Quotes: delayed ~15 min · gammadesk.app', right: 'Not investment advice' },
};

export function samplePoster(kind: PosterKind): PosterData {
  return kind === 'morning' ? MORNING : CLOSING;
}
