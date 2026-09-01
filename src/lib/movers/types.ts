import type { Gics } from '../rs/universe';

/**
 * Shapes for the intraday movers list.
 *
 * ## What this is not
 *
 * It is not the scanner, and nothing here may ever be presented as scanner
 * output. The scanner answers "which names pass five hard rules", and it is
 * built to return nothing on a day when nothing passes. This answers a
 * different and much weaker question — "what moved in the last completed
 * session" — and it
 * applies exactly one gate, on volume, for exactly one reason: a large move on
 * thin volume is not a move, it is a print.
 *
 * The two must not leak into each other in either direction. A movers row is
 * not a candidate, and the existence of this list is not a reason to loosen
 * anything on the scanner. See `MOVERS_EXPLANATION` below, which is the line
 * the page is required to carry.
 */

/**
 * Relative volume a name must clear to appear at all.
 *
 * The only exclusion on the list. Everything else in this file is a warning
 * that is shown and never acted on — see `MoverWarning`.
 */
export const MIN_RELATIVE_VOLUME = 1.5;

/**
 * Above this, relative volume is itself worth warning about.
 *
 * Three times normal is not "participating"; it is usually one piece of news,
 * and a name up six percent on a single headline is the exact thing a movers
 * list invites a reader to chase. Flagged, never removed.
 */
export const HIGH_RELATIVE_VOLUME = 3;

/** Rows shown. Deliberately short — this is a glance, not a universe. */
export const MAX_MOVERS = 15;

/** Distance above the 20-day average at which a name is called extended. */
export { EXTENDED_PCT } from '../scanner/types';

/**
 * The heading line the page must carry above the list.
 *
 * Kept here rather than typed into the component so it cannot drift, and so a
 * reviewer can see in one place that the list describes itself as having met
 * no quality bar.
 */
export const MOVERS_HEADING = 'Moved last session';
export const MOVERS_EXPLANATION =
  'Moved last session — these met no quality bar. They moved, and here is what to check.';

/**
 * Why a row carries a warning.
 *
 * Every one of these is *shown*, never applied. A movers list is where people
 * chase, so the warnings matter more here than they do on the scanner, and the
 * temptation to quietly drop the ugliest rows is exactly the thing that would
 * turn this page back into a recommendation.
 *
 * `earnings-unknown` is a warning in its own right rather than an absence of
 * one. An unknown earnings date is not a clear earnings date — the same rule
 * `scanner/earnings.ts` is built around.
 */
export type MoverWarning =
  /** Reports within `EARNINGS_WARN_DAYS`. */
  | 'earnings'
  /** No earnings date could be established. Never read as "clear". */
  | 'earnings-unknown'
  /** Trading below its 200-day average. */
  | 'below-200'
  /** More than `EXTENDED_PCT` above its 20-day average. */
  | 'extended'
  /** Relative volume past `HIGH_RELATIVE_VOLUME`, so possibly one event. */
  | 'volume-spike';

/** Where a name sits against its 200-day average. */
export type TrendPosition = 'above' | 'below' | 'unknown';

export interface MoverRow {
  symbol: string;
  /** Latest traded price. */
  last: number;
  /** Yesterday's close, which the change is measured from. */
  prevClose: number;
  /** Change since yesterday's close, in percent. The ranking key. */
  changePct: number;

  /** Today's cumulative share volume. */
  volume: number;
  /** Its 20-session average share volume, from the stored digest. */
  avgVolume20: number;
  /** `volume / avgVolume20`. See `MoversResult.sessionProgress`. */
  relativeVolume: number;

  /** Against the 200-day average. `unknown` when the shard has no reading. */
  trend: TrendPosition;
  /** Percent above or below the 200-day average. Null when unknown. */
  pctFrom200: number | null;
  /** Percent above or below the 20-day average. Null when unknown. */
  pctFrom20: number | null;

  /** 0-100 relative-strength composite from /strength. Null when unranked. */
  rsScore: number | null;
  /** Its rank in the full universe, 1 = strongest. Null when unranked. */
  rsRank: number | null;

  sector: Gics | null;
  sectorName: string | null;
  /**
   * Whether that sector is one the momentum engine currently has
   * accelerating. Null when there is no stored sectors snapshot to ask.
   */
  sectorLeading: boolean | null;

  /** Everything true about this row that a reader should check. */
  warnings: MoverWarning[];
  /** The earnings date behind an `earnings` flag, `YYYY-MM-DD`. */
  earningsDate: string | null;
}

export interface MoversResult {
  rows: MoverRow[];

  /** When these quotes were read, ISO-8601 UTC. */
  capturedAt: string;
  /** New York wall clock of the same instant, `HH:MM`. */
  capturedEt: string;
  /**
   * The completed session these numbers describe, `YYYY-MM-DD`.
   *
   * Always a session that has closed — this list never reports the day in
   * progress. It is the RS digest's own `asOfDate` rather than a date derived
   * from the clock, because the digest is where the percentage change comes
   * from and the two must not be able to disagree. The page is required to
   * show it: a reader has to be able to see which day they are looking at.
   */
  sessionDate: string;

  /** Constituents with stored history for that session. */
  measured: number;
  /** Symbols in the universe this run asked for. */
  universe: number;
  /** Names that were up on the session before the volume gate was applied. */
  gainers: number;
  /** Of those, how many cleared `MIN_RELATIVE_VOLUME`. */
  qualified: number;
  /** Gainers whose 20-day average volume is not stored yet, so ungradeable. */
  noVolumeBaseline: number;

  /** Upstream requests this refresh spent. */
  requests: number;
  /** Anything that limits how the rows above should be read. */
  notes: string[];
}
