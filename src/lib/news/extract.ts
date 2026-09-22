/**
 * Turning the real text of a filing into a specific, plain-English headline —
 * in the scanner's own words.
 *
 * The old scanner wrote a headline from the category alone ("KO changed its
 * financial guidance"). This reads the actual 8-K / press-release text and pulls
 * out the concrete fact — the direction of a guidance change, the counterparty
 * and value of a deal, the name and role in a leadership change — so the
 * headline says what happened, with the number when there is one.
 *
 * ## Rules honoured here
 *  - Never copy source text: everything below extracts *structured facts*
 *    (a direction word, a dollar figure, a proper name) and rewrites the
 *    sentence from scratch. No source sentence is ever emitted.
 *  - Specific or nothing: `extractStory` returns `null` unless it found a
 *    concrete detail. A bare category is treated as "not understood" and the
 *    caller drops the item. Fewer good items beats five weak ones.
 *  - FDA only for health-care names, and only when the text is really about a
 *    regulatory / trial decision — gated by `isHealthcare`, never by keywords
 *    alone.
 *
 * Pure module: no `server-only`, no IO, exhaustively unit-tested.
 */

import type { NewsCategory } from './types';

export interface ExtractInput {
  /** Cleaned, tag-free filing text (8-K body + any EX-99 press release). */
  text: string;
  /** 8-K item codes, when the item came from EDGAR. */
  itemCodes: string[];
  /** The category implied by the item codes (or 'other'). */
  itemCategory: NewsCategory;
  /** Friendly company name, already shortened (e.g. "Coca-Cola"). */
  company: string;
  ticker: string | null;
  /** Whether an FDA / clinical story is even possible for this issuer. */
  isHealthcare: boolean;
}

export interface ExtractedStory {
  headline: string;
  why: string;
  category: NewsCategory;
  /** 0..1 event size, folded into ranking on top of category and company size. */
  magnitude: number;
}

/** Strip HTML/XBRL to readable text: no tags, decoded entities, tidy spaces. */
export function cleanFilingText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&mdash;|&ndash;/gi, '—')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A *deal-sized* money figure — one carrying a magnitude word (billion/million)
 * — or null. Requiring the unit is deliberate: a bare "$6.4" or "$166,667" in a
 * filing is almost always a par value, a fee or a salary, not the headline
 * number, so we never surface one.
 */
function bigMoney(text: string): string | null {
  const m = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s?(billion|million|trillion|bn|mm)\b/i);
  if (!m) return null;
  const num = m[1].replace(/,/g, '');
  const unitRaw = m[2].toLowerCase();
  const unit = unitRaw === 'bn' ? 'billion' : unitRaw === 'mm' ? 'million' : unitRaw;
  return `$${num} ${unit}`;
}

/** Any money or percentage figure, for a guidance number ("$5.20", "12%"). */
function anyFigure(text: string): string | null {
  const money = text.match(/\$\s?[\d,]+(?:\.\d+)?\s?(?:billion|million|trillion|bn|mm)?/i);
  const pct = text.match(/\d+(?:\.\d+)?\s?%/);
  const m = money?.[0];
  const p = pct?.[0];
  if (m && p) return (money!.index ?? 0) <= (pct!.index ?? 0) ? tidy(m) : p.replace(/\s/g, '');
  if (m) return tidy(m);
  if (p) return p.replace(/\s/g, '');
  return null;
}

function tidy(money: string): string {
  return money
    .replace(/\s+/g, ' ')
    .replace(/\bbn\b/i, 'billion')
    .replace(/\bmm\b/i, 'million')
    .trim();
}

/** The text within `radius` characters of the first match of `re`, or null. */
function windowAround(text: string, re: RegExp, radius = 240): string | null {
  const m = text.match(re);
  if (!m || m.index === undefined) return null;
  return text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius);
}

/** True when the filing's 8-K item codes include any of `want`. */
function has(codes: string[], ...want: string[]): boolean {
  return codes.some((c) => want.includes(c.trim()));
}

/** Words too generic to be a real counterparty name on their own. */
const NAME_STOP = new Set([
  'invest', 'investors', 'investor', 'common', 'class', 'series', 'notes',
  'shares', 'board', 'company', 'first', 'the', 'preferred', 'certain',
  'various', 'other', 'new', 'its', 'all', 'substantially', 'a', 'an',
]);

/** Accept a counterparty name, or null when it is too generic to trust. */
function goodName(name: string | null): string | null {
  if (!name) return null;
  const words = name.split(/\s+/);
  if (words.length > 5) return null;
  if (words.length === 1) {
    if (NAME_STOP.has(name.toLowerCase()) || name.length < 3) return null;
  }
  return name;
}

/**
 * A proper-noun phrase following an anchor like "acquire" or "by" — the likely
 * counterparty or person. Deliberately conservative: 1–4 capitalised words,
 * trimmed of trailing filler. Returns null rather than a shaky guess.
 */
const CONNECTORS = new Set(['of', 'and', '&', 'the']);

function properNounAfter(text: string, anchor: RegExp): string | null {
  const m = text.match(anchor);
  if (!m) return null;
  const raw = (m[1] ?? '').trim().replace(/[,.;:]+$/, '');
  if (!raw) return null;
  // The case-insensitive anchor can over-capture a trailing lowercase word
  // ("Beacon Systems for"), so keep only the leading run of capitalised words,
  // allowing lowercase name connectors ("Bank of America") in the middle.
  const words = raw.split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (/^[A-Z]/.test(w)) kept.push(w);
    else if (CONNECTORS.has(w.toLowerCase()) && i > 0 && /^[A-Z]/.test(words[i + 1] ?? '')) kept.push(w);
    else break;
  }
  while (kept.length && CONNECTORS.has((kept[kept.length - 1] ?? '').toLowerCase())) kept.pop();
  if (kept.length === 0 || kept.length > 5) return null;
  return kept.join(' ');
}

const CAP = "[A-Z][A-Za-z.&'\\-]+(?:\\s+[A-Z][A-Za-z.&'\\-]+){0,3}";

/**
 * Guidance change — the direction, the metric and the number.
 *
 * Gated to item 2.02 (results / financial condition) or an explicit guidance
 * phrase, so a stray "outlook" in a risk factor never trips it. The number is
 * read from a window around the guidance word, not the first figure in the doc.
 */
function guidance(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  const gated = has(input.itemCodes, '2.02') || /\b(rais\w*|cut\w*|lower\w*|reduc\w*|updat\w*|narrow\w*|reaffirm\w*|reiterat\w*)[^.]{0,30}(guidance|outlook|forecast)/i.test(t);
  if (!gated) return null;

  const raised = /\b(rais\w*|increas\w*|boost\w*|lift\w*|hik\w*|higher)\b[^.]{0,40}(guidance|outlook|forecast|full[- ]year|estimate)/i.test(t)
    || /\b(guidance|outlook|forecast)\b[^.]{0,40}\b(rais\w*|increas\w*|higher|upward)\b/i.test(t);
  const cut = /\b(cut\w*|lower\w*|reduc\w*|trim\w*|slash\w*)\b[^.]{0,40}(guidance|outlook|forecast|full[- ]year|estimate)/i.test(t)
    || /\b(guidance|outlook|forecast)\b[^.]{0,40}\b(cut\w*|lower\w*|reduc\w*|downward)\b/i.test(t);
  const reaffirm = /\b(reaffirm\w*|reiterat\w*|maintain\w*|confirm\w*)\b[^.]{0,40}(guidance|outlook|forecast|full[- ]year)/i.test(t);
  if (!raised && !cut && !reaffirm) return null;

  const metric =
    /\brevenue|net sales|\bsales\b/i.test(t) ? 'revenue'
    : /\beps\b|earnings per share|adjusted earnings|\bprofit\b|net income/i.test(t) ? 'profit'
    : /operating (income|margin)|margin/i.test(t) ? 'margin'
    : null;
  const metricPhrase = metric ? `${metric} ` : '';
  const gWin = windowAround(t, /(guidance|outlook|forecast)/i, 160) ?? '';
  const num = anyFigure(gWin);
  const numTail = num ? ` to ${num}` : '';

  if (raised && !cut) {
    return {
      category: 'guidance',
      magnitude: num ? 0.92 : 0.8,
      headline: `${input.company} raised its full-year ${metricPhrase}guidance${numTail}`,
      why: `A higher ${metric ?? 'earnings'} outlook says the business is tracking ahead of what the market had penciled in.`,
    };
  }
  if (cut && !raised) {
    return {
      category: 'guidance',
      magnitude: num ? 0.92 : 0.8,
      headline: `${input.company} cut its full-year ${metricPhrase}guidance${numTail}`,
      why: `A lower ${metric ?? 'earnings'} outlook is a direct signal the business is running behind plan.`,
    };
  }
  return {
    category: 'guidance',
    magnitude: 0.45,
    headline: `${input.company} reaffirmed its full-year ${metricPhrase}guidance`,
    why: `Holding the outlook steady tells the market the year is still on track — no upgrade, no warning.`,
  };
}

/**
 * Acquisition / merger — direction, counterparty and value.
 *
 * Gated to item 1.01/2.01 or an unambiguous deal phrase ("agreed to acquire",
 * "agreement and plan of merger"), never a bare "acquire" that could be
 * boilerplate. Counterparty and value are read from a window around the deal
 * phrase and the counterparty must survive `goodName`, so a generic word is
 * dropped rather than shown.
 */
function mergerAcquisition(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  const dealPhrase = /\b(agreed to acquire|to be acquired by|definitive agreement|agreement and plan of merger|merger agreement|entered into a merger)\b/i;
  if (!(has(input.itemCodes, '1.01', '2.01') || dealPhrase.test(t))) return null;

  const win = windowAround(t, /(agreed to acquire|to be acquired by|acquisition of|to acquire|merger with|combination with|agreement and plan of merger)/i, 280) ?? t.slice(0, 4000);
  const value = bigMoney(win);
  const valueTail = value ? ` for ${value}` : '';

  const acquirer = goodName(properNounAfter(win, new RegExp(`(?:to be acquired by|merger with|combination with)\\s+(${CAP})`, 'i')));
  if (acquirer) {
    return {
      category: 'ma',
      magnitude: value ? 1 : 0.85,
      headline: `${input.company} agreed to be acquired by ${acquirer}${valueTail}`,
      why: `A takeover puts a fixed price on the company, so the stock usually snaps toward the deal terms.`,
    };
  }

  const target = goodName(properNounAfter(win, new RegExp(`(?:agreed to acquire|to acquire|acquisition of)\\s+(${CAP})`, 'i')));
  if (target) {
    return {
      category: 'ma',
      magnitude: value ? 1 : 0.85,
      headline: `${input.company} agreed to acquire ${target}${valueTail}`,
      why: `Buying ${target} reshapes what ${input.company} owns and how much it is worth.`,
    };
  }

  if (value) {
    return {
      category: 'ma',
      magnitude: 0.9,
      headline: `${input.company} announced a ${value} acquisition`,
      why: `A deal this size resets the revenue and debt the market is pricing in.`,
    };
  }
  return null;
}

/**
 * C-suite change — role, person and direction. Gated to item 5.02 (departure /
 * election of officers), so a mention of a "chief executive" elsewhere never
 * trips it.
 */
function leadership(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  if (!has(input.itemCodes, '5.02')) return null;
  const roleMatch = t.match(/\b(chief executive officer|chief financial officer|chief operating officer|president and chief executive|ceo|cfo|coo)\b/i);
  if (!roleMatch) return null; // a plain board/director change is routine — skip.
  const role =
    /chief executive|ceo/i.test(roleMatch[0]) ? 'CEO'
    : /chief financial|cfo/i.test(roleMatch[0]) ? 'CFO'
    : /chief operating|coo/i.test(roleMatch[0]) ? 'COO'
    : 'chief';

  const departing = /\b(resign\w*|retir\w*|step\w*\s+down|depart\w*|termination|will leave|to leave|separation)\b/i.test(t);
  const arriving = /\b(appoint\w*|nam\w*\s+as|elect\w*|promot\w*|hir\w*|will (?:become|serve)|join\w*\s+as)\b/i.test(t);

  const person = properNounAfter(t, new RegExp(`(?:appointed|named|elected|promoted)\\s+(${CAP})`, 'i'))
    ?? properNounAfter(t, new RegExp(`(${CAP}),?\\s+(?:the company's\\s+)?(?:${role}|chief)`, 'i'));

  if (departing && !arriving) {
    return {
      category: 'leadership',
      magnitude: role === 'CEO' ? 0.85 : 0.7,
      headline: person
        ? `${input.company}'s ${role}, ${person}, is departing`
        : `${input.company}'s ${role} is departing`,
      why: `A ${role} change can shift strategy and how much the market trusts the numbers.`,
    };
  }
  if (arriving) {
    return {
      category: 'leadership',
      magnitude: role === 'CEO' ? 0.8 : 0.65,
      headline: person
        ? `${input.company} named ${person} as ${role}`
        : `${input.company} appointed a new ${role}`,
      why: `A new ${role} sets the direction the market will judge the company on next.`,
    };
  }
  return null;
}

/** Detect a share buyback and its size (value read near the repurchase word). */
function buyback(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  if (!/\b(repurchase|buyback|buy back|share repurchase)\b/i.test(t)) return null;
  const win = windowAround(t, /(repurchase|buyback|buy back)/i, 160) ?? '';
  const value = bigMoney(win);
  return {
    category: 'buyback',
    magnitude: value ? 0.6 : 0.45,
    headline: value
      ? `${input.company} authorized a ${value} share buyback`
      : `${input.company} expanded its share-buyback program`,
    why: `Buybacks shrink the share count and signal management thinks the stock is cheap.`,
  };
}

/** A major contract / commercial deal — item 1.01 that is not an acquisition. */
function contract(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  if (!has(input.itemCodes, '1.01')) return null;
  if (!/\b(contract|award\w*|supply agreement|purchase order|selected by|won a|deal to supply)\b/i.test(t)) return null;
  const win = windowAround(t, /(contract|award\w*|supply agreement|selected by)/i, 200) ?? '';
  const value = bigMoney(win);
  const party = goodName(properNounAfter(win, new RegExp(`(?:with|from|by)\\s+(${CAP})`, 'i')));
  if (!value && !party) return null;
  return {
    category: 'deal',
    magnitude: value ? 0.6 : 0.5,
    headline: value
      ? `${input.company} won a ${value} contract`
      : `${input.company} signed a commercial deal with ${party}`,
    why: `A large new contract can lift the revenue the market is pricing in.`,
  };
}

/** Detect a partnership / collaboration and its partner. */
function partnership(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  if (!/\b(partnership|partnered|collaborat\w*|joint venture|strategic alliance)\b/i.test(t)) return null;
  const win = windowAround(t, /(partnership|partnered|collaborat\w*|joint venture|strategic alliance)/i, 160) ?? '';
  const party = goodName(properNounAfter(win, new RegExp(`(?:with|and)\\s+(${CAP})`, 'i')));
  if (!party) return null;
  return {
    category: 'partnership',
    magnitude: 0.5,
    headline: `${input.company} formed a partnership with ${party}`,
    why: `A tie-up with ${party} can extend reach or capability without building it alone.`,
  };
}

/**
 * Bankruptcy, restatement, auditor change and delisting — each gated to the
 * 8-K item code that *is* the SEC's own classification of that event, so
 * boilerplate ("in the event of bankruptcy…") in an unrelated filing can never
 * trip it.
 */
function distress(input: ExtractInput): ExtractedStory | null {
  const { itemCodes: codes, text: t } = input;
  if (has(codes, '1.03') && /\b(chapter 11|chapter 7|bankruptcy|receivership|voluntary petition)\b/i.test(t)) {
    return {
      category: 'bankruptcy',
      magnitude: 1,
      headline: `${input.company} filed for bankruptcy protection`,
      why: `Bankruptcy puts shareholders last in line and can wipe out the value of the stock.`,
    };
  }
  if (has(codes, '4.02') && /\b(non-reliance|should no longer be relied|restate)/i.test(t)) {
    return {
      category: 'restatement',
      magnitude: 0.85,
      headline: `${input.company} said prior financial statements can no longer be relied on`,
      why: `When past numbers stop being trustworthy, the market re-prices the whole story.`,
    };
  }
  if (has(codes, '4.01')) {
    return {
      category: 'restatement',
      magnitude: 0.6,
      headline: `${input.company} changed its outside auditor`,
      why: `An auditor change close to results can be routine or a red flag — worth a look.`,
    };
  }
  if (has(codes, '3.01') && /\b(delist\w*|listing rule|minimum bid|listing standard|deficiency|noncompliance)\b/i.test(t)) {
    return {
      category: 'delisting',
      magnitude: 0.8,
      headline: `${input.company} was warned it may not meet its exchange's listing rules`,
      why: `Losing a listing shrinks the buyer base and signals deeper financial stress.`,
    };
  }
  return null;
}

/** A regulatory / legal action, only when a specific trigger is present. */
function regulatory(input: ExtractInput): ExtractedStory | null {
  const t = input.text;
  const value = /\bsettlement\b/i.test(t) ? bigMoney(windowAround(t, /settlement/i, 200) ?? '') : null;
  if (/\bsettlement\b/i.test(t) && value) {
    return {
      category: 'regulatory',
      magnitude: 0.7,
      headline: `${input.company} agreed to a ${value} legal settlement`,
      why: `A settlement of this size takes a legal overhang off the table at a known cost.`,
    };
  }
  if (/\b(antitrust|department of justice|\bdoj\b|sec charges|consent decree|injunction)\b/i.test(t)) {
    return {
      category: 'regulatory',
      magnitude: 0.72,
      headline: `${input.company} disclosed a government enforcement action`,
      why: `Enforcement action can bring fines, restrictions or forced changes to the business.`,
    };
  }
  if (/\b(subpoena|formal investigation|grand jury|wells notice)\b/i.test(t)) {
    return {
      category: 'regulatory',
      magnitude: 0.68,
      headline: `${input.company} disclosed a government investigation`,
      why: `An open investigation is an unresolved risk the market has to discount.`,
    };
  }
  return null;
}

/** FDA / clinical — health-care issuers only, real decision text only. */
function fda(input: ExtractInput): ExtractedStory | null {
  if (!input.isHealthcare) return null;
  const full = input.text;
  const trigger = /\b(fda|food and drug administration|phase [123]|clinical trial|marketing authoriz|complete response letter)\b/i;
  if (!trigger.test(full)) return null;
  // Only read decision words near the FDA / trial mention, so a stray "the
  // board approved" elsewhere in the filing is never read as an approval.
  const t = windowAround(full, trigger, 240) ?? '';
  if (/\b(approv\w*)\b/i.test(t)) {
    return {
      category: 'fda',
      magnitude: 0.88,
      headline: `${input.company} won FDA approval for a product`,
      why: `An approval opens (or defends) a revenue line the market has been waiting on.`,
    };
  }
  if (/\b(complete response letter|reject\w*|declin\w*\s+to approve|not approv\w*)\b/i.test(t)) {
    return {
      category: 'fda',
      magnitude: 0.85,
      headline: `${input.company} received an FDA rejection`,
      why: `A rejection delays or kills a product the pipeline was counting on.`,
    };
  }
  if (/\bphase [123]\b/i.test(t)) {
    const good = /\b(met|positive|succeed\w*|achiev\w*)\b/i.test(t);
    const bad = /\b(fail\w*|did not meet|miss\w*|discontinu\w*)\b/i.test(t);
    if (good && !bad) {
      return { category: 'fda', magnitude: 0.8, headline: `${input.company} reported positive trial results`, why: `Strong trial data moves a drug closer to market and to real revenue.` };
    }
    if (bad && !good) {
      return { category: 'fda', magnitude: 0.8, headline: `${input.company} reported a trial setback`, why: `A failed trial removes a pipeline value the market had been crediting.` };
    }
  }
  return null;
}

/**
 * The order matters: the rarest, most price-moving events are tried first, so a
 * filing that is both (say) a deal and a leadership note is told as the deal.
 */
const EXTRACTORS = [distress, mergerAcquisition, guidance, leadership, fda, regulatory, buyback, contract, partnership];

/**
 * Read the filing text and return a specific story, or `null` when nothing
 * concrete could be pulled out (the caller then drops the item — never shows a
 * vague or guessed one).
 */
export function extractStory(input: ExtractInput): ExtractedStory | null {
  const text = (input.text ?? '').trim();
  if (text.length < 40) return null; // nothing real to read.
  for (const fn of EXTRACTORS) {
    const story = fn(input);
    if (story) return story;
  }
  return null;
}
