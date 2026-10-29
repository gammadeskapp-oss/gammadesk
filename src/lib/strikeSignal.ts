import type { StrikeRow } from './types';

/**
 * The exposure tables' Signal column: do GEX, VEX and CEX point the same way
 * at a strike, and how much open interest sits behind it.
 *
 * An agreement check, not a score. Nothing is blended or weighted — each of
 * the three only contributes its sign, and open interest never votes. It
 * describes the book at that strike; it is not a buy or sell call.
 *
 * Pure, and the one place the rule lives, so every table that shows these
 * metrics labels a strike the same way.
 *
 * ## Votes
 *
 * Each metric's all-expiration total at the strike votes + or −. A value
 * smaller than `NEUTRAL_SHARE` of that metric's largest absolute total in the
 * same table abstains: the three are in different units, so "small" can only
 * mean small for that metric, and a few dollars of charm at a far strike is
 * noise, not a vote.
 *
 * | votes (+ / − / abstain) | label     |
 * |-------------------------|-----------|
 * | 3/0/0, 0/3/0            | Confirmed |
 * | 2 one way, third either abstains or opposes | Aligned |
 * | 1/1/1                   | Conflict  |
 * | 1/0/2, 0/1/2, 0/0/3     | Mixed     |
 *
 * 2-against-1 is Aligned, not Conflict: two of three still agree. Conflict is
 * kept for the case with no majority at all — one each way, the third silent.
 *
 * ## Open-interest tag
 *
 * Gross open interest (calls plus puts) at the strike, ranked against every
 * strike in the same table: top quarter "strong", bottom quarter "thin",
 * nothing in between. Gross, not the net OI tab's calls-minus-puts — a strike
 * with 50k calls and 50k puts open is heavily backed, not empty.
 */

export type SignalVote = 1 | -1 | 0;
export type SignalLabel = 'Confirmed' | 'Aligned' | 'Mixed' | 'Conflict';
export type SignalOiTag = 'strong' | '' | 'thin';

export interface StrikeSignal {
  label: SignalLabel;
  oiTag: SignalOiTag;
  /** The direction the agreeing metrics point; 0 for Mixed and Conflict. */
  direction: SignalVote;
  votes: { gex: SignalVote; vex: SignalVote; cex: SignalVote };
  /** Gross open interest at the strike, calls plus puts. */
  grossOi: number;
}

/** A metric below this share of its own column's largest |value| abstains. */
export const NEUTRAL_SHARE = 0.02;
/** Gross-OI percentile at or above which a strike is "strong". */
export const STRONG_OI_PERCENTILE = 0.75;
/** Gross-OI percentile at or below which a strike is "thin". */
export const THIN_OI_PERCENTILE = 0.25;

export function vote(value: number, columnMaxAbs: number): SignalVote {
  if (!Number.isFinite(value) || columnMaxAbs <= 0) return 0;
  if (Math.abs(value) < NEUTRAL_SHARE * columnMaxAbs) return 0;
  return value > 0 ? 1 : -1;
}

export function classify(votes: readonly SignalVote[]): { label: SignalLabel; direction: SignalVote } {
  const up = votes.filter((v) => v === 1).length;
  const down = votes.filter((v) => v === -1).length;
  if (up === votes.length) return { label: 'Confirmed', direction: 1 };
  if (down === votes.length) return { label: 'Confirmed', direction: -1 };
  if (up >= 2) return { label: 'Aligned', direction: 1 };
  if (down >= 2) return { label: 'Aligned', direction: -1 };
  if (up >= 1 && down >= 1) return { label: 'Conflict', direction: 0 };
  return { label: 'Mixed', direction: 0 };
}

/**
 * Where `value` falls among `sorted` (ascending), 0 to 1: the share of the
 * other strikes it is above, with ties counted half — so a table of equal
 * strikes puts every one at 0.5 and tags none of them.
 */
function percentile(value: number, sorted: readonly number[]): number {
  if (sorted.length <= 1) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (below + (equal - 1) / 2) / (sorted.length - 1);
}

export function oiTag(grossOi: number, sortedGrossOi: readonly number[]): SignalOiTag {
  if (!(grossOi > 0)) return 'thin';
  const p = percentile(grossOi, sortedGrossOi);
  if (p >= STRONG_OI_PERCENTILE) return 'strong';
  if (p <= THIN_OI_PERCENTILE) return 'thin';
  return '';
}

/** One signal per row, keyed by strike, from the rows' all-expiration totals. */
export function strikeSignals(rows: readonly StrikeRow[]): Map<number, StrikeSignal> {
  let gexMax = 0;
  let vexMax = 0;
  let cexMax = 0;
  const gross: number[] = [];
  for (const { total } of rows) {
    if (Number.isFinite(total.gex)) gexMax = Math.max(gexMax, Math.abs(total.gex));
    if (Number.isFinite(total.vex)) vexMax = Math.max(vexMax, Math.abs(total.vex));
    if (Number.isFinite(total.cex)) cexMax = Math.max(cexMax, Math.abs(total.cex));
    gross.push(grossOiOf(total));
  }
  gross.sort((a, b) => a - b);

  const out = new Map<number, StrikeSignal>();
  for (const { strike, total } of rows) {
    const votes = { gex: vote(total.gex, gexMax), vex: vote(total.vex, vexMax), cex: vote(total.cex, cexMax) };
    const grossOi = grossOiOf(total);
    out.set(strike, {
      ...classify([votes.gex, votes.vex, votes.cex]),
      oiTag: oiTag(grossOi, gross),
      votes,
      grossOi,
    });
  }
  return out;
}

function grossOiOf(total: StrikeRow['total']): number {
  const n = (Number.isFinite(total.callOi) ? total.callOi : 0) + (Number.isFinite(total.putOi) ? total.putOi : 0);
  return Math.max(0, n);
}

/** "Confirmed · strong", "Aligned", "Mixed · thin". */
export function signalText(signal: StrikeSignal): string {
  return signal.oiTag ? `${signal.label} · ${signal.oiTag}` : signal.label;
}

const sign = (v: SignalVote) => (v === 1 ? '+' : v === -1 ? '−' : '0');

/** The hover line under a Signal cell: each vote, and the open interest behind it. */
export function signalDetail(signal: StrikeSignal, formatOi: (n: number) => string): string {
  const { gex, vex, cex } = signal.votes;
  return `GEX ${sign(gex)} · VEX ${sign(vex)} · CEX ${sign(cex)}\nGross OI ${formatOi(signal.grossOi)} (calls + puts)`;
}
