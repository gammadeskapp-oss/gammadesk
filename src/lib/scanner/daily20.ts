/**
 * Assembling the Daily 20 — ten bullish leaders and ten bearish laggards,
 * quality-gated first and then ranked, with the two separate labels every name
 * carries so that "top-ranked" can never be read as "buy now".
 *
 * ## Gate, then rank — in that order
 *
 * A name is run through `gateRow` first. Only names that clear the gate are
 * scored and ranked; a high `directionScore` can never pull an unqualified name
 * onto the list. This is the whole reason the two live in separate modules.
 *
 * ## Two axes, deliberately
 *
 * Every entry carries a **leadership** label (how strong/weak is it, relative
 * to the market) and a **setup** label (is the timing any good right now).
 * They are different questions and the page shows both, because a strongest-in-
 * class leader that has run 15% from its 20-day average is a different
 * proposition from the same leader pulling back into support. The combined
 * `displayLabel` folds the two into one phrase from a fixed vocabulary that
 * never says buy or sell.
 *
 * ## Pure and feed-free
 *
 * This takes `ScanRow[]` and plain lookup maps for the readings that live on
 * other pages (RS window percentiles, sector strength, gamma room). It adds no
 * data source. A caller that has not wired a map yet passes nothing and the
 * dependent component simply drops out of the blend — see `directionScore`.
 */

import {
  directionScore,
  type Direction,
  type DirectionScore,
  type DirectionInputs,
} from './directionScore';
import {
  gateRow,
  DAILY20_GATES,
  DEFAULT_GATE_FLAGS,
  type GateFlags,
  type GateResult,
  type GateSettings,
  type RsWindows,
} from './daily20Gate';
import type { ScanRow } from './types';

/** How many names on each side of the Daily 20. */
export const DAILY20_PER_SIDE = 10;

// --- labels ------------------------------------------------------------------

/** Where price sits in its own move right now — the "timing" axis. */
export type SetupState =
  | 'breaking-out'
  | 'pullback'
  | 'extended'
  | 'breaking-down'
  | 'stretched'
  | 'neutral';

export const SETUP_LABEL: Record<SetupState, string> = {
  'breaking-out': 'Breaking out',
  pullback: 'Pullback to 21-day',
  extended: 'Extended',
  'breaking-down': 'Breaking down',
  stretched: 'Stretched',
  neutral: 'No clear setup',
};

/**
 * The setup state from price posture. Bullish and bearish read the same fields
 * from opposite ends. `extendedPct` is the gate's own band so the two agree on
 * what "extended" means.
 */
export function setupState(
  row: ScanRow,
  direction: Direction,
  extendedPct: number = DAILY20_GATES.extendedPct,
): SetupState {
  const m = row.metrics;
  const above20 = m.pctAbove20;
  const aboveVwap = m.pctAboveVwap;

  if (direction === 'bullish') {
    if (above20 !== null && above20 > extendedPct) return 'extended';
    // Pulling back into the 20-day while the medium trend holds.
    if (above20 !== null && above20 < 0 && (m.pctAbove50 ?? 0) >= 0) return 'pullback';
    // Pushing up through the recent average with the close above VWAP.
    if (above20 !== null && above20 >= 0 && (aboveVwap ?? 0) >= 0) return 'breaking-out';
    return 'neutral';
  }

  if (above20 !== null && above20 < -extendedPct) return 'stretched';
  if (above20 !== null && above20 < 0) return 'breaking-down';
  return 'neutral';
}

/** The leadership (strength) axis, from the direction score. */
export function leadershipLabel(direction: Direction, score: number): string {
  if (direction === 'bullish') {
    if (score >= 75) return 'Strong leader';
    if (score >= 60) return 'Leader';
    return 'Emerging leader';
  }
  if (score >= 75) return 'Heavy laggard';
  if (score >= 60) return 'Laggard';
  return 'Softening';
}

/**
 * The combined display label, from a fixed vocabulary:
 *   Actionable leader / Leader, extended / Watch for confirmation /
 *   Actionable laggard / Laggard, stretched.
 *
 * It folds leadership and setup together so a reader sees the single honest
 * phrase, and it is the one place that decides it so the page cannot drift.
 */
export function displayLabel(direction: Direction, setup: SetupState): string {
  if (direction === 'bullish') {
    if (setup === 'extended') return 'Leader, extended';
    if (setup === 'breaking-out' || setup === 'pullback') return 'Actionable leader';
    return 'Watch for confirmation';
  }
  if (setup === 'stretched') return 'Laggard, stretched';
  if (setup === 'breaking-down') return 'Actionable laggard';
  return 'Watch for confirmation';
}

/** A short, non-directional one-liner for the row. The fuller templates for the
 *  Decision page live in `daily20Reason.ts` (ship-order step 7). */
export function shortReason(
  entry: Pick<Daily20Entry, 'direction' | 'rank' | 'score' | 'setup'>,
): string {
  const side = entry.direction === 'bullish' ? 'leader' : 'laggard';
  const rs = entry.score.components.rs;
  const rsPart = rs === null ? 'RS unread' : `RS ${Math.round(rs)}`;
  return `#${entry.rank} ${side} — ${rsPart}, ${SETUP_LABEL[entry.setup].toLowerCase()}.`;
}

// --- entries -----------------------------------------------------------------

export interface Daily20Entry {
  symbol: string;
  direction: Direction;
  /** 1-based position within its side's displayed top-N. */
  rank: number;
  row: ScanRow;
  score: DirectionScore;
  gate: GateResult;
  setup: SetupState;
  leadership: string;
  display: string;
  reason: string;
}

export interface AssembleInputs {
  /** Per-symbol RS window percentiles (from the RS result). */
  rsPercentilesBySymbol?: Map<string, RsWindows>;
  /** Per-symbol sector strength 0-100 (from the sectors page). */
  sectorStrengthBySymbol?: Map<string, number>;
  /** Per-symbol gamma room 0-100 (from the gamma map). */
  gammaRoomBySymbol?: Map<string, number>;
  settings?: GateSettings;
  flags?: GateFlags;
  perSide?: number;
}

export interface Daily20 {
  bullish: Daily20Entry[];
  bearish: Daily20Entry[];
  /** How many names cleared the gate on each side, before the top-N cut. */
  eligible: { bullish: number; bearish: number };
}

function buildSide(
  rows: ScanRow[],
  direction: Direction,
  inputs: AssembleInputs,
): { entries: Daily20Entry[]; eligible: number } {
  const settings = inputs.settings ?? DAILY20_GATES;
  const flags = inputs.flags ?? DEFAULT_GATE_FLAGS;
  const perSide = inputs.perSide ?? DAILY20_PER_SIDE;

  const gated = rows
    .map((row) => {
      const rsPercentiles = inputs.rsPercentilesBySymbol?.get(row.symbol) ?? null;
      const gate = gateRow(row, direction, { settings, flags, rsPercentiles });
      return { row, gate };
    })
    .filter((g) => g.gate.passes);

  const scored = gated.map(({ row, gate }) => {
    const di: DirectionInputs = {
      sectorStrength: inputs.sectorStrengthBySymbol?.get(row.symbol) ?? null,
      gammaRoom: inputs.gammaRoomBySymbol?.get(row.symbol) ?? null,
    };
    const score = directionScore(row, direction, di);
    return { row, gate, score };
  });

  scored.sort(
    (a, b) => b.score.total - a.score.total || a.row.symbol.localeCompare(b.row.symbol),
  );

  const entries = scored.slice(0, perSide).map(({ row, gate, score }, i): Daily20Entry => {
    const setup = setupState(row, direction, settings.extendedPct);
    const base = { symbol: row.symbol, direction, rank: i + 1, row, score, gate, setup };
    const leadership = leadershipLabel(direction, score.total);
    const display = displayLabel(direction, setup);
    return {
      ...base,
      leadership,
      display,
      reason: shortReason(base),
    };
  });

  return { entries, eligible: scored.length };
}

/**
 * Build the Daily 20 from a scored universe.
 *
 * Bullish and bearish are assembled independently from the same rows — a name
 * can in principle appear nowhere (gated out both ways) or, in a genuinely
 * conflicted tape, be eligible on neither. It cannot lead and lag at once in
 * practice, because the gates are mutually exclusive on the 50-day MA.
 */
export function assembleDaily20(rows: ScanRow[], inputs: AssembleInputs = {}): Daily20 {
  const bull = buildSide(rows, 'bullish', inputs);
  const bear = buildSide(rows, 'bearish', inputs);
  return {
    bullish: bull.entries,
    bearish: bear.entries,
    eligible: { bullish: bull.eligible, bearish: bear.eligible },
  };
}
