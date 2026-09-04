/**
 * The macro translator's reasoning, as pure functions with no I/O.
 *
 * ## What this file is, and what it refuses to be
 *
 * It turns an economic release, and the overnight tape, into plain English
 * about whether financial conditions eased or tightened. It is a *translator*,
 * not a sentiment meter and never a signal: nothing here may say buy, sell,
 * reduce, or add, and nothing here predicts a direction. "Conditions tightened"
 * is a statement about the mechanics of a print. "Reduce risk" is advice about
 * what to do with it, and there is deliberately no code path that can produce
 * the second kind.
 *
 * ## Why it is pure, and separated from the fetching
 *
 * Same split the events calendar uses (`events/rules.ts` pure, `events/index.ts`
 * loads the JSON): the reasoning takes its inputs as arguments so
 * `verify:macro` can walk every combination — every surprise sign against every
 * direction, every way the overnight votes can conflict, and every way an input
 * can be missing — and check that none of them crosses into a forecast or an
 * instruction. The fetching lives in `consensus.ts` and `overnight.ts`.
 *
 * ## The two hard requirements this module encodes
 *
 * 1. The mechanical reading and the actual market reaction are always produced
 *    together, and their disagreement is stated out loud rather than smoothed
 *    over. See `reactionNote`.
 * 2. The overnight aggregate is *allowed to be unclear, and is built to reach
 *    that verdict often*. Conflicting inputs are called mixed, not averaged into
 *    a number — see `aggregateOvernight`. A translator that always picks a side
 *    is a sentiment meter wearing a disclaimer.
 */

/** Which way a rising print pushes financial conditions. */
export type SurpriseDirection = 'higher_is_tightening' | 'higher_is_easing';

/** The mechanical reading of one release. */
export type Reading = 'tightening' | 'easing' | 'in_line';

/**
 * One high-impact release, as the translator needs it.
 *
 * `consensus` is what was expected, `previous` the prior print — carried for
 * display only, because the surprise is measured against consensus, never
 * against previous (see `surpriseReading`). `actual` is null until the number
 * has been released.
 */
export interface EconEvent {
  event: string;
  /** ISO instant the number is released. */
  releaseAt: string;
  consensus: number;
  previous: number;
  /** The released figure, or null before the release. */
  actual: number | null;
  /** Suffix rendered after each figure, e.g. `%`, `K`, or empty. */
  unit: string;
  direction: SurpriseDirection;
  /**
   * How far `actual` may sit from `consensus` and still read as in line, in the
   * event's own unit. Optional; defaults to 0, i.e. only an exact match is in
   * line. A release quoted in whole thousands (jobless claims) will usually set
   * a non-zero tolerance so a one-thousand miss is not called a surprise.
   */
  inLineTolerance?: number;
}

/** The signed difference of a release from what was expected. */
export interface Surprise {
  reading: Reading;
  /** `actual − consensus`, so positive means the print came in higher. */
  signedSurprise: number;
  /** `higher`, `lower`, or `in line` — the surprise before direction is applied. */
  side: 'higher' | 'lower' | 'in_line';
}

/**
 * Grade a release against consensus.
 *
 * The comparison is to consensus, not to previous, and that is the whole point
 * of the rule: a print can be the highest in a year and still be a dovish
 * surprise if it came in under what the market had already braced for. Measuring
 * against previous would call that a tightening, which is the reading the market
 * is not taking.
 *
 * `actual === null` (not yet released) returns `in_line` with a zero surprise —
 * callers should check `actual` before wording it, but a null must never throw
 * inside a render.
 */
export function surpriseReading(event: EconEvent): Surprise {
  if (event.actual === null) {
    return { reading: 'in_line', signedSurprise: 0, side: 'in_line' };
  }

  const signedSurprise = event.actual - event.consensus;
  const tol = Math.abs(event.inLineTolerance ?? 0);

  if (Math.abs(signedSurprise) <= tol) {
    return { reading: 'in_line', signedSurprise, side: 'in_line' };
  }

  const side = signedSurprise > 0 ? 'higher' : 'lower';
  // Apply the event's own convention. A higher print tightens when
  // higher_is_tightening (CPI, PPI, PCE, payrolls, wages) and eases when
  // higher_is_easing (the unemployment rate, jobless claims).
  const higherTightens = event.direction === 'higher_is_tightening';
  const reading: Reading =
    side === 'higher'
      ? higherTightens
        ? 'tightening'
        : 'easing'
      : higherTightens
        ? 'easing'
        : 'tightening';

  return { reading, signedSurprise, side };
}

/** Render a figure with its unit, e.g. `3.1%`. Trims trailing zeros. */
function fig(value: number, unit: string): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}

/** `+0.4%` / `−0.2%` / `0.0%` — a signed change, with a real minus sign. */
export function signedPct(changePct: number): string {
  const rounded = Math.round(changePct * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

const CONDITION_CLAUSE: Record<Reading, string> = {
  tightening: 'Mechanically this tightens conditions.',
  easing: 'Mechanically this eases conditions.',
  in_line: 'Mechanically this leaves conditions about where they were.',
};

const SIDE_WORDS: Record<Surprise['side'], string> = {
  higher: 'higher than forecast',
  lower: 'lower than forecast',
  in_line: 'in line with forecast',
};

/**
 * The one-line translation of a released number.
 *
 * "CPI came in at 3.1% vs 2.9% expected — higher than forecast. Mechanically
 * this tightens conditions."
 *
 * Before the release it says so rather than inventing a reading, because a
 * consensus with no actual beside it is a schedule entry, not a result.
 */
export function translateRelease(event: EconEvent): string {
  if (event.actual === null) {
    return `${event.event} is due, with ${fig(event.consensus, event.unit)} expected against ${fig(event.previous, event.unit)} prior. No reading until it prints.`;
  }

  const { reading, side } = surpriseReading(event);
  return `${event.event} came in at ${fig(event.actual, event.unit)} vs ${fig(event.consensus, event.unit)} expected — ${SIDE_WORDS[side]}. ${CONDITION_CLAUSE[reading]}`;
}

/**
 * The mechanical reading beside the market's actual response, with disagreement
 * flagged.
 *
 * The textbook response to a tightening print is equities lower and to an
 * easing print equities higher. Markets move against the textbook constantly —
 * they are pricing the whole distribution, not this one number — and pretending
 * otherwise is how a mechanical reading gets mistaken for a forecast. So when
 * the tape and the mechanics disagree, this says so in plain words rather than
 * hiding the tension.
 *
 * `spyChangePct` is the equity-futures overnight change. Null when there is no
 * quote — then there is a reading but nothing to check it against, and the
 * sentence says exactly that.
 */
export interface Reaction {
  sentence: string;
  /** True when the tape matches the textbook response, false when it fights it. */
  agrees: boolean | null;
}

export function reactionNote(
  reading: Reading,
  spyChangePct: number | null,
  flatPct = OVERNIGHT_FLAT_PCT,
): Reaction {
  const lead =
    reading === 'tightening'
      ? 'This print tightens conditions.'
      : reading === 'easing'
        ? 'This print eases conditions.'
        : 'This print leaves conditions about where they were.';

  if (spyChangePct === null) {
    return {
      sentence: `${lead} There is no equity-futures quote to read the response against yet.`,
      agrees: null,
    };
  }

  const move = signedPct(spyChangePct);

  // A flat tape says nothing either way, and calling a 0.1% drift agreement or
  // disagreement invents precision the number does not carry.
  if (Math.abs(spyChangePct) < flatPct || reading === 'in_line') {
    return {
      sentence: `${lead} Market reaction so far: SPY futures ${move} — little immediate response.`,
      agrees: null,
    };
  }

  const textbookUp = reading === 'easing';
  const agrees = textbookUp ? spyChangePct > 0 : spyChangePct < 0;
  const tail = agrees
    ? 'the textbook response.'
    : 'not the textbook response.';

  return {
    sentence: `${lead} Market reaction so far: SPY futures ${move} — ${tail}`,
    agrees,
  };
}

// --- overnight -------------------------------------------------------------

/**
 * The lean one overnight instrument casts toward global risk conditions.
 *
 * `risk-off` covers the tightening lean too — a stronger dollar, a higher US
 * 10-year and rising JGB yields all tighten global conditions, and they sit on
 * the same side of the aggregate as equities selling off. `neutral` is a move
 * too small to count, cast by nothing.
 */
export type OvernightLean = 'risk-on' | 'risk-off' | 'neutral';

/**
 * How each instrument's overnight change maps to a lean, and which sign leans
 * which way.
 *
 * `up` is the lean when the instrument rises by more than the flat band;
 * falling cast the opposite. Written out per instrument rather than inferred,
 * because the mapping is the substance — a weak yen (USDJPY up) tightening
 * global liquidity is a claim worth stating in one readable place, not deriving
 * from a sign convention buried in a loop.
 */
export const OVERNIGHT_RULES: Record<string, { up: OvernightLean; note: string }> = {
  // A weaker yen (USDJPY higher) drains global liquidity — the carry unwind and
  // the BoJ's grip are the mechanism. Leans tightening.
  USDJPY: { up: 'risk-off', note: 'weaker yen leans tighter global liquidity' },
  // Rising Japanese long yields tighten the cheapest funding in the world.
  JGB10Y: { up: 'risk-off', note: 'rising JGB yields lean tighter' },
  // Asia equities taking part is risk appetite showing up first.
  NIKKEI: { up: 'risk-on', note: 'stronger Japan equities lean risk-on' },
  KOSPI: { up: 'risk-on', note: 'stronger Korea equities lean risk-on' },
  // A rising dollar is tighter conditions for everyone funding in it.
  DXY: { up: 'risk-off', note: 'a firmer dollar leans tighter' },
  // A rising US 10-year lifts the global discount rate.
  US10Y: { up: 'risk-off', note: 'a higher US 10-year leans tighter' },
  // The fear gauge, straightforwardly.
  VIX: { up: 'risk-off', note: 'a higher VIX leans risk-off' },
  // Overnight equity futures, straightforwardly.
  SPY: { up: 'risk-on', note: 'firmer S&P futures lean risk-on' },
  QQQ: { up: 'risk-on', note: 'firmer Nasdaq futures lean risk-on' },
};

/**
 * How much a row must move overnight before it casts a vote at all.
 *
 * Below this it is called flat and casts nothing. FX and equity index futures
 * routinely drift a fraction of a percent on nothing overnight, and a threshold
 * of zero would let that noise decide the aggregate. Same posture as the VIX
 * flat band on the home page.
 */
export const OVERNIGHT_FLAT_PCT = 0.3;

export interface OvernightRow {
  /** Key into `OVERNIGHT_RULES`. */
  key: string;
  changePct: number;
}

/** The lean one row casts, given its change and the flat band. */
export function rowLean(row: OvernightRow, flatPct = OVERNIGHT_FLAT_PCT): OvernightLean {
  const rule = OVERNIGHT_RULES[row.key];
  if (!rule || Math.abs(row.changePct) < flatPct) return 'neutral';
  if (row.changePct > 0) return rule.up;
  return rule.up === 'risk-on' ? 'risk-off' : rule.up === 'risk-off' ? 'risk-on' : 'neutral';
}

export type OvernightAggregate = 'risk-on' | 'risk-off' | 'mixed';

export interface OvernightVerdict {
  aggregate: OvernightAggregate;
  /** One finished sentence. Always says what it is, never what to do. */
  sentence: string;
  riskOn: number;
  riskOff: number;
}

/**
 * Combine the overnight rows into one verdict, biased toward honesty over a
 * clean answer.
 *
 * The rule is deliberately not a weighted average. Averaging a risk-on Nikkei
 * against a risk-off dollar produces a number near zero that reads as a
 * confident "neutral", when the truth is that two forces are pulling in
 * opposite directions and the session has not resolved which wins. That is
 * `mixed`, and it is a different, more useful thing to tell a reader than a
 * needle parked in the middle.
 *
 * So: any genuine conflict is mixed. Only a one-sided board — votes on one side
 * and none on the other — is called. Nothing decisive is also mixed, said as
 * "quiet" rather than as a reading. `stale` short-circuits to mixed regardless
 * of the votes, because a verdict drawn from old quotes is worse than no
 * verdict.
 */
export function aggregateOvernight(
  rows: OvernightRow[],
  options: { stale?: boolean; flatPct?: number } = {},
): OvernightVerdict {
  const flatPct = options.flatPct ?? OVERNIGHT_FLAT_PCT;

  if (options.stale) {
    return {
      aggregate: 'mixed',
      sentence:
        'The overnight quotes are stale, so there is no reliable read across the session — treat the rows below as unconfirmed.',
      riskOn: 0,
      riskOff: 0,
    };
  }

  let riskOn = 0;
  let riskOff = 0;
  for (const row of rows) {
    const lean = rowLean(row, flatPct);
    if (lean === 'risk-on') riskOn += 1;
    else if (lean === 'risk-off') riskOff += 1;
  }

  if (riskOn > 0 && riskOff > 0) {
    return {
      aggregate: 'mixed',
      sentence: `Overnight is mixed — ${riskOn} reading${riskOn === 1 ? '' : 's'} lean risk-on and ${riskOff} lean risk-off, so the session has not settled on a direction. Read the rows below rather than the label.`,
      riskOn,
      riskOff,
    };
  }

  if (riskOn === 0 && riskOff === 0) {
    return {
      aggregate: 'mixed',
      sentence:
        'Overnight is quiet — nothing moved far enough to lean the session one way or the other.',
      riskOn,
      riskOff,
    };
  }

  if (riskOn > 0) {
    return {
      aggregate: 'risk-on',
      sentence: `Overnight leans risk-on — ${riskOn} of the readings point that way and none against, though that is a lean, not a forecast.`,
      riskOn,
      riskOff,
    };
  }

  return {
    aggregate: 'risk-off',
    sentence: `Overnight leans risk-off — ${riskOff} of the readings point that way and none against, though that is a lean, not a forecast.`,
    riskOn,
    riskOff,
  };
}

/** The plain-English clause for one overnight row, e.g. for the row's caption. */
export function rowClause(row: OvernightRow, flatPct = OVERNIGHT_FLAT_PCT): string {
  const rule = OVERNIGHT_RULES[row.key];
  if (!rule) return 'no reading';
  const lean = rowLean(row, flatPct);
  if (lean === 'neutral') return 'little changed overnight';
  return rule.note;
}
