/**
 * Industry gating and friendly company names for the news scanner.
 *
 * Two jobs, both pure (no `server-only`, no IO) so `scripts/verify-news.mjs`
 * can drive them:
 *
 *  1. `isHealthcare` — the FDA / clinical category may only ever be attached to
 *     a drug, biotech or device company. A social-media or chip company can
 *     never have an "FDA decision", so this set is the hard gate that stops the
 *     old keyword matcher from ever labelling e.g. META as an FDA story.
 *
 *  2. `shortName` — turn a legal issuer name ("Meta Platforms, Inc.", "The
 *     Coca-Cola Company") into the name a person would actually say ("Meta",
 *     "Coca-Cola"), so a headline reads naturally and the name appears once.
 */

/**
 * Tickers where an FDA / clinical-trial story is even possible: pharma, biotech,
 * medical-device and health-care names. Nothing outside this set is ever allowed
 * the `fda` category, no matter what a headline's keywords say.
 */
const HEALTHCARE = new Set(
  [
    'LLY', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'AMGN', 'BMY',
    'GILD', 'VRTX', 'REGN', 'MRNA', 'BIIB', 'ISRG', 'MDT', 'SYK', 'BSX', 'ZTS',
    'CVS', 'CI', 'HUM', 'UNH', 'ELV', 'MCK', 'BDX', 'EW', 'DXCM', 'IDXX',
    'IQV', 'A', 'BIO', 'ILMN', 'RMD', 'HCA', 'CNC', 'ZBH', 'BAX', 'WST',
  ].map((t) => t.toUpperCase()),
);

/** True when an FDA / clinical decision is plausible for this ticker at all. */
export function isHealthcare(ticker: string | null): boolean {
  return Boolean(ticker && HEALTHCARE.has(ticker.toUpperCase()));
}

/**
 * Hand-curated friendly names for the biggest names, where a mechanical cleanup
 * of the legal name would still read oddly (an abbreviation, a holding company,
 * a name the public never uses). Keyed by ticker.
 */
const NAME_BY_TICKER: Record<string, string> = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'Nvidia',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  GOOG: 'Alphabet',
  META: 'Meta',
  AVGO: 'Broadcom',
  TSLA: 'Tesla',
  'BRK.B': 'Berkshire Hathaway',
  LLY: 'Eli Lilly',
  JPM: 'JPMorgan',
  XOM: 'ExxonMobil',
  UNH: 'UnitedHealth',
  KO: 'Coca-Cola',
  PEP: 'PepsiCo',
  PG: 'Procter & Gamble',
  JNJ: 'Johnson & Johnson',
  WMT: 'Walmart',
  ABBV: 'AbbVie',
  BAC: 'Bank of America',
  CRM: 'Salesforce',
  CVX: 'Chevron',
  HD: 'Home Depot',
  MCD: "McDonald's",
  PM: 'Philip Morris',
  IBM: 'IBM',
  GE: 'GE Aerospace',
  DIS: 'Disney',
  MRK: 'Merck',
  QCOM: 'Qualcomm',
  TXN: 'Texas Instruments',
  AMGN: 'Amgen',
};

/** Trailing corporate boilerplate stripped off a legal name, longest first. */
const SUFFIXES = [
  'incorporated', 'corporation', 'company', 'holdings', 'holding', 'group',
  'limited', 'inc', 'corp', 'co', 'plc', 'ltd', 'lp', 'sa', 'nv', 'ag',
];

/**
 * A friendly, speakable company name. Prefers the curated map, then a cleaned
 * version of the issuer name, and finally the ticker so the result is never
 * empty. Never returns "TICKER (TICKER)" — the caller pairs this with the
 * ticker itself exactly once.
 */
export function shortName(company: string | null | undefined, ticker: string | null): string {
  const t = ticker ? ticker.toUpperCase() : null;
  if (t && NAME_BY_TICKER[t]) return NAME_BY_TICKER[t];

  let name = (company ?? '').trim();
  // An EDGAR display name sometimes arrives as just the ticker (wire/press
  // items) — there is no real name to show, so fall back to the ticker.
  if (!name || (t && name.toUpperCase() === t)) return t ?? (name || '—');

  name = name.replace(/\/[A-Z]{2,4}\/?$/i, '').trim(); // "/DE/" state-of-incorp tags
  name = name.replace(/\bclass\s+[a-c]\b/gi, '').trim(); // "Class A"
  name = name.replace(/^the\s+/i, '').trim();

  // Strip trailing corporate suffixes, possibly several ("Holdings Inc").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const re = new RegExp(`[\\s,]+${suffix}\\.?$`, 'i');
      if (re.test(name)) {
        name = name.replace(re, '').trim();
        changed = true;
      }
    }
  }
  name = name.replace(/[\s,]+$/, '').trim();
  return name || t || '—';
}
