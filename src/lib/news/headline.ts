/**
 * Turning a raw filing into plain English — in the scanner's own words.
 *
 * This is where the "never copy source text verbatim" rule is kept. Nothing
 * here reads the filing's prose. A headline is built from three structured
 * facts only: the company name, the ticker, and the category the item was
 * classified into (which itself comes from 8-K item codes or matched keyword
 * tokens, not from copied sentences). So every headline is generated, jargon-
 * free, and free of buy/sell language and predictions.
 *
 * Pure module — no `server-only`, no IO — so it is exhaustively unit-tested.
 */

import type { NewsCategory, Tier } from './types';

/**
 * 8-K item codes → category. The item code is the SEC's own structured index of
 * what a current report is about, so it is a far cleaner signal than scraping
 * the body. Only the codes that carry market meaning are mapped; everything
 * else falls through to `other` and is filtered as boilerplate.
 *
 * Reference (SEC Form 8-K item numbers):
 *  1.01 Entry into a Material Definitive Agreement (deals / M&A terms)
 *  1.02 Termination of a Material Definitive Agreement
 *  1.03 Bankruptcy or Receivership
 *  2.01 Completion of Acquisition or Disposition of Assets
 *  2.02 Results of Operations and Financial Condition (earnings)
 *  2.04 Triggering Events That Accelerate a Financial Obligation
 *  2.05 Costs Associated with Exit or Disposal Activities
 *  2.06 Material Impairments
 *  3.01 Notice of Delisting / Failure to Satisfy a Listing Rule
 *  4.01 Changes in Registrant's Certifying Accountant
 *  4.02 Non-Reliance on Previously Issued Financial Statements (restatement)
 *  5.02 Departure/Election of Directors or Principal Officers
 *  7.01 Regulation FD Disclosure
 *  8.01 Other Events
 */
const ITEM_CATEGORY: Record<string, NewsCategory> = {
  '1.01': 'ma',
  '1.02': 'ma',
  '1.03': 'bankruptcy',
  '2.01': 'ma',
  '2.02': 'earnings',
  '2.04': 'regulatory',
  '2.05': 'restatement',
  '2.06': 'restatement',
  '3.01': 'delisting',
  '4.01': 'restatement',
  '4.02': 'restatement',
  '5.02': 'leadership',
};

/**
 * Category for a set of 8-K item codes. When several codes are present the most
 * material one wins, ranked by `TIER_RANK` below — a filing that both reports
 * earnings (2.02) and announces a CEO change (5.02) is a leadership story.
 */
export function categoryForItems(codes: string[]): NewsCategory {
  let best: NewsCategory = 'other';
  let bestRank = -1;
  for (const raw of codes) {
    const code = raw.trim();
    const cat = ITEM_CATEGORY[code];
    if (!cat) continue;
    const rank = CATEGORY_RANK[cat];
    if (rank > bestRank) {
      bestRank = rank;
      best = cat;
    }
  }
  return best;
}

/** Which High/Medium/Ignore bucket each category sits in — the brief's list. */
export const CATEGORY_TIER: Record<NewsCategory, Tier> = {
  ma: 'high',
  deal: 'high',
  guidance: 'high',
  bankruptcy: 'high',
  delisting: 'high',
  leadership: 'high',
  buyback: 'high',
  regulatory: 'high',
  fda: 'high',
  restatement: 'high',
  product: 'medium',
  partnership: 'medium',
  insider: 'medium',
  earnings: 'ignore',
  other: 'ignore',
};

/**
 * Relative materiality within a filing when several categories apply. Higher
 * wins. Roughly follows the tiers but keeps the rarest, most price-moving items
 * (bankruptcy, M&A, restatement) above the merely-high ones.
 */
const CATEGORY_RANK: Record<NewsCategory, number> = {
  bankruptcy: 100,
  restatement: 95,
  delisting: 90,
  ma: 85,
  regulatory: 80,
  fda: 78,
  guidance: 75,
  leadership: 70,
  buyback: 65,
  deal: 60,
  partnership: 40,
  product: 38,
  insider: 35,
  earnings: 10,
  other: 0,
};

/** Plain-English label for a category, used in headlines and the console. */
export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  ma: 'Deal / acquisition',
  deal: 'Major contract',
  guidance: 'Guidance change',
  bankruptcy: 'Bankruptcy',
  delisting: 'Delisting risk',
  leadership: 'Leadership change',
  buyback: 'Buyback',
  regulatory: 'Regulatory action',
  fda: 'FDA / clinical',
  restatement: 'Accounting restatement',
  product: 'New product',
  partnership: 'Partnership',
  insider: 'Insider move',
  earnings: 'Earnings',
  other: 'Routine filing',
};

/** The subject used in a sentence: the ticker if known, else the company. */
function subject(company: string, ticker: string | null): string {
  const name = (company || '').trim();
  if (ticker && name) return `${name} (${ticker})`;
  if (ticker) return ticker;
  return name || 'A company';
}

export interface PlainText {
  headline: string;
  why: string;
}

/**
 * Generate the plain-English headline and the one-line "why it matters" for a
 * classified item. Deliberately generic and factual: it states the kind of
 * event, not a copied description of it, and never says whether to buy or sell.
 *
 * The reader always has the source link for the specifics; this is the scanner
 * telling them, in its own words, what bucket the filing falls in and why a
 * bucket like that tends to move a stock.
 */
export function plainEnglish(
  category: NewsCategory,
  company: string,
  ticker: string | null,
): PlainText {
  const who = subject(company, ticker);
  switch (category) {
    case 'ma':
      return {
        headline: `${who} disclosed a deal or acquisition agreement`,
        why: 'Mergers and acquisitions reset what a company is worth and often move both sides sharply.',
      };
    case 'deal':
      return {
        headline: `${who} announced a major contract or commercial deal`,
        why: 'A large new contract can change the revenue outlook the market is pricing in.',
      };
    case 'guidance':
      return {
        headline: `${who} changed its financial guidance`,
        why: 'A raised or cut outlook is one of the most direct signals of how the business is tracking.',
      };
    case 'bankruptcy':
      return {
        headline: `${who} filed a bankruptcy or receivership notice`,
        why: 'Bankruptcy leaves shareholders last in line and can wipe out the value of the equity.',
      };
    case 'delisting':
      return {
        headline: `${who} flagged a listing-rule or delisting problem`,
        why: 'Losing an exchange listing shrinks the buyer base and signals deeper financial stress.',
      };
    case 'leadership':
      return {
        headline: `${who} reported a change in its top leadership`,
        why: 'A CEO or CFO change shifts strategy and how much the market trusts the numbers.',
      };
    case 'buyback':
      return {
        headline: `${who} announced a share buyback`,
        why: 'Buybacks shrink the share count and signal management thinks the stock is cheap.',
      };
    case 'regulatory':
      return {
        headline: `${who} disclosed a regulatory or legal action`,
        why: 'Regulatory action can bring fines, restrictions, or forced changes to the business.',
      };
    case 'fda':
      return {
        headline: `${who} reported an FDA or clinical decision`,
        why: 'For drug and device makers, a regulatory decision can make or break a product line.',
      };
    case 'restatement':
      return {
        headline: `${who} flagged an accounting restatement or auditor change`,
        why: 'When past numbers can no longer be relied on, the market re-prices the whole story.',
      };
    case 'product':
      return {
        headline: `${who} launched or updated a product`,
        why: 'A significant product move can open a new revenue line or defend an existing one.',
      };
    case 'partnership':
      return {
        headline: `${who} entered a new partnership`,
        why: 'Partnerships can extend reach or capability without the company building it alone.',
      };
    case 'insider':
      return {
        headline: `${who} reported a large insider transaction`,
        why: 'Large insider transactions hint at how the people closest to the business see it.',
      };
    case 'earnings':
      return {
        headline: `${who} posted quarterly results`,
        why: 'Routine results still set the near-term tone, though they are the market’s daily bread.',
      };
    default:
      return {
        headline: `${who} made a routine filing`,
        why: 'Most filings are administrative and rarely move the stock on their own.',
      };
  }
}
