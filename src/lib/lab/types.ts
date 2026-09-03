import type { LiveOverlay, PriceSource } from '../live/types';

/**
 * Shapes for /lab, the private research page.
 *
 * Deliberately free of `server-only` and of anything that pulls it in: the
 * table applies the weights in the browser, so the scoring in `score.ts` has
 * to run in both places. Same arrangement as `scanner/types.ts`, and for the
 * same reason — a weight the reader drags must never be able to reach the
 * network.
 *
 * ## What this page is and is not
 *
 * It is a ranked list over the whole index, built from readings the app has
 * already stored, so that one question can be answered by eye over a few days:
 * does blending these six components surface names the individual pages do
 * not, or does it reshuffle the same list? Nothing here is a filter, a gate or
 * a shortlist. Every name in the universe is on it, always, and the only thing
 * the weights change is the order.
 */

/** The six components the composite blends. */
export const LAB_KEYS = [
  'gammaRegime',
  'flipDistance',
  'magnetDistance',
  'rs',
  'flow',
  'analogue',
] as const;
export type LabKey = (typeof LAB_KEYS)[number];

export const LAB_LABEL: Record<LabKey, string> = {
  gammaRegime: 'Gamma',
  flipDistance: 'Flip',
  magnetDistance: 'Magnet',
  rs: 'RS',
  flow: 'Flow',
  analogue: 'Analogue',
};

export const LAB_LONG_LABEL: Record<LabKey, string> = {
  gammaRegime: 'Ticker gamma regime',
  flipDistance: 'Distance to flip',
  magnetDistance: 'Distance to nearest magnet',
  rs: 'Relative strength percentile',
  flow: 'Options flow signal',
  analogue: 'Analogue hit rate',
};

/**
 * What each component measures, and — where it is not obvious — which
 * direction this page happens to have pointed it in.
 *
 * The direction is stated out loud wherever it is a choice rather than a fact,
 * because it is exactly the sort of choice that disappears into a composite
 * and then gets mistaken for a finding. The two where the choice is least
 * defensible open at weight zero and say so here, so the disclosure and the
 * default agree; setting any other weight to zero is how to take a choice back
 * out by hand.
 */
export const LAB_EXPLANATION: Record<LabKey, string> = {
  gammaRegime:
    "This name's own dealer positioning. Positive scores 100, negative 25 — the same two values the scanner uses, and for the same reason: which side dealers are on in a single stock is an inference, not a published fact, so it should not be able to knock a name down as hard as a measured number can.",
  flipDistance:
    'How far the close sits from the gamma flip level, as a percent of price. Scored so that NEARER is higher: at the flip the positioning regime is the least settled, which is what makes it worth a look. That is a direction this page chose, not something the data says — which is why it opens at weight zero. Switch it on deliberately, on its own, and watch what moves.',
  magnetDistance:
    'How far the close sits from the nearest positive-gamma strike above it and the nearest below. Scored on the closer of the two, NEARER is higher. Same caveat as the flip, and the same default: it opens at weight zero, because the sign is a guess and an untested guess left switched on quietly conditions every reading of the ranking.',
  rs: 'The composite relative-strength score from /strength — where the name ranks against the whole index over one, three and six months. Used exactly as that page publishes it, so the two cannot disagree.',
  flow:
    'The most unusual contract on the name in the last stored flow scan, measured as volume against open interest. Direction-blind on purpose: a heavily traded put and a heavily traded call both score here, because this component measures that something happened and not what.',
  analogue:
    'Of the past sessions that met the same condition this name meets today, the share that finished higher 21 sessions later. Not fetched until asked for — it costs a full price history per name — so it is absent on every row until you load it.',
};

/**
 * Which clock each component is on once a live overlay is applied.
 *
 * `stored` — nothing about the component moves. It was computed from a stored
 * document (the option chain the gamma job pulled, the relative-strength
 * digest, the flow scan, a daily bar history) and a live quote does not touch
 * it. Most of this page is here.
 *
 * `mixed` — the component is a distance, so the *price* half of it goes live
 * and the *level* half stays exactly as stored. That is the reading worth
 * having and it is also the one worth being careful about: the number moves
 * tick by tick while the thing it is measured against was fixed this morning.
 *
 * Nothing is `live` outright, and that is not an omission. Every reading on
 * this page is either a property of an option chain, a ranking over months of
 * bars, or a count over decades of them. A quote cannot make any of those
 * current — it can only change where price sits relative to them.
 */
export const LAB_CLOCK: Record<LabKey, 'stored' | 'mixed'> = {
  gammaRegime: 'stored',
  flipDistance: 'mixed',
  magnetDistance: 'mixed',
  rs: 'stored',
  flow: 'stored',
  analogue: 'stored',
};

/** What the clock label means for one component, in a sentence. */
export const LAB_CLOCK_NOTE: Record<LabKey, string> = {
  gammaRegime:
    'Unchanged by a live price. Dealer positioning is built from open interest, which publishes once a day after the close, so the reading is as old as the gamma refresh whatever the quote says.',
  flipDistance:
    'Live price, stored level. The flip level was computed from the morning chain and does not move; the distance to it moves with every tick. Two clocks in one number.',
  magnetDistance:
    'Live price, stored strikes. The magnets are the large positive-gamma strikes from the morning chain; only the distance to them is current.',
  rs: 'Unchanged by a live price. It ranks months of closes against the index, and today is one bar of that — the digest updates nightly.',
  flow: 'Unchanged by a live price. The flow scan runs once after the close and describes that session.',
  analogue:
    'Unchanged by a live price. The condition is detected on the latest completed daily bar, and the hit rate counts sessions that finished decades ago.',
};

export type LabWeights = Record<LabKey, number>;

/**
 * Opening weights: one vote each, except the two whose direction is a guess.
 *
 * Flat rather than considered among the four that are in, and that is the
 * point of the page. The scanner ships a weighting it can argue for; this one
 * ships none, so that whatever the ranking shows is a property of the
 * components rather than of an opinion baked in before anybody looked.
 *
 * ## Flip and magnet distance open at zero
 *
 * Both are scored nearer-is-higher, and nobody has established that this is
 * the right way round — proximity to a level is interesting, it is not good,
 * and the opposite sign is just as arguable. A component whose direction is
 * unknown, switched on by default, does not make the ranking more informative;
 * it makes every reading of the ranking conditional on a coin flip nobody
 * remembers making.
 *
 * So they start out of the blend and get switched on deliberately, one at a
 * time, which is the only way to see what either of them does. The scoring and
 * both span constants stay exactly as they are in `score.ts` — this is a
 * default, not a removal, and moving the slider is the whole experiment.
 */
export const DEFAULT_LAB_WEIGHTS: LabWeights = {
  gammaRegime: 1,
  flipDistance: 0,
  magnetDistance: 0,
  rs: 1,
  flow: 1,
  analogue: 1,
};

export const WEIGHT_BOUNDS = { min: 0, max: 3, step: 0.25 } as const;

/** A gamma magnet as the gamma job stores it. */
export interface LabMagnet {
  strike: number;
  gex: number;
}

/**
 * Everything one name contributes, as measured values and never as verdicts.
 *
 * Every field that can be absent is `null` rather than 0, and the `*Note`
 * fields say why. That distinction is the whole page: most of the index has no
 * flow reading because the flow scan covers eighty names, and scoring those
 * absences as zero would rank the index below the flow universe on the
 * strength of which chains a job had time for.
 */
export interface LabRow {
  symbol: string;
  /**
   * The price every distance on this row is measured from.
   *
   * The live quote when there is one, the stored daily close otherwise.
   * `priceSource` says which, on every row, because a distance measured from a
   * live price against a level computed this morning is on two clocks and the
   * page has to be able to say so.
   */
  price: number | null;
  priceAsOf: string;
  /** Which clock `price` is on. See `PriceSource`. */
  priceSource: PriceSource;
  /**
   * The stored daily close, kept even when a live price is in use.
   *
   * Carried so the row can show both. A live overlay that overwrote the stored
   * number would leave the reader unable to see how far the name has moved
   * since the reading everything else on the row was computed from — which is
   * the one thing the overlay is useful for.
   */
  storedPrice: number | null;
  /** Percent from the stored close to the live price. Null without an overlay. */
  livePctFromStored: number | null;

  /** Dealer positioning, or null when no chain was pulled for this name. */
  regime: 'positive' | 'negative' | null;
  netGex: number | null;
  /** Why `regime` is null. Null when it is not. */
  gammaNote: string | null;

  /** The gamma flip level from the stored gamma document. */
  flipLevel: number | null;
  /** Signed percent from close to flip: positive means the flip is above. */
  flipPct: number | null;
  flipNote: string | null;

  /** Nearest positive-gamma strike above the close, and the percent to it. */
  magnetAbove: LabMagnet | null;
  magnetAbovePct: number | null;
  /** Nearest positive-gamma strike below the close, and the percent to it. */
  magnetBelow: LabMagnet | null;
  magnetBelowPct: number | null;
  magnetNote: string | null;

  /** 0-100 composite from /strength, used as published. */
  rsScore: number | null;
  rsRank: number | null;
  /** Names in the ranked pool `rsRank` is a position within. */
  rsPool: number;
  rsNote: string | null;

  flow: LabFlow | null;
  flowNote: string | null;

  /**
   * Filled in only after the reader loads it. Absent is the default state and
   * is not a reading — see `LAB_EXPLANATION.analogue`.
   */
  analogue?: LabAnalogue | null;
}

/** The unusual-activity reading for one name, from the stored flow scan. */
export interface LabFlow {
  /** Contracts on this name the flow scan flagged. Zero is a real reading. */
  flagged: number;
  /** The highest volume-to-open-interest among them. Null when none flagged. */
  topVolumeToOi: number | null;
  topLabel: string | null;
  calls: number;
  puts: number;
  /** Whole-chain put/call volume ratio, for context in the expansion. */
  putCallVolume: number | null;
}

/** One name's analogue reading, fetched on demand. */
export interface LabAnalogue {
  /** The condition the hit rate is for. Null when none is active today. */
  conditionId: string | null;
  conditionLabel: string | null;
  /** Every condition active on the latest bar, for the expansion. */
  activeLabels: string[];
  /** Share of matches that finished higher over the horizon, 0-100. */
  positivePct: number | null;
  /** Matches with the horizon fully elapsed. */
  n: number;
  /** Under ten matches. Still scored, always said. */
  thin: boolean;
  /** Distinct episodes behind `n` — overlapping matches are not independent. */
  episodes: number | null;
  /** Sessions the hit rate is measured over. */
  horizon: number;
  /** Populated when there is no reading; then `positivePct` is null. */
  note: string | null;
}

/** The horizon the hit rate is taken at. */
export const LAB_ANALOGUE_HORIZON = 21;

/** Names one analogue request will fetch, so one click cannot start 503. */
export const LAB_ANALOGUE_BATCH = 25;

/** What the page ships to the browser. */
export interface LabView {
  rows: LabRow[];
  /** New York date of the scan the readings came from. */
  scanDate: string | null;
  scannedAt: string | null;
  /** Date of the gamma document, which need not be the scan's date. */
  gammaDate: string | null;
  /** Session the flow scan describes. */
  flowDate: string | null;
  /**
   * The live-price overlay, or the reason there is none.
   *
   * Never populated in production: the token it needs is not set there, and
   * this page does not render there either. See `lib/live/index.ts`.
   */
  live: LiveOverlay;
  /** How many rows carry each component, counted on the server. */
  coverage: Record<Exclude<LabKey, 'analogue'>, number>;
  /** Everything that stopped a component being universal, in plain English. */
  notes: string[];
}
