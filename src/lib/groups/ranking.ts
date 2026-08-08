import { GROUPS } from './definitions';
import type { GroupsSnapshot, TickerScore } from './types';

/**
 * Relative-strength ranking across every tracked ticker.
 *
 * Derived from the daily group snapshot rather than recomputed, so /strength
 * costs no upstream requests at all — the nine-signal engine has already run
 * on each of these symbols.
 */

export interface RankedTicker {
  rank: number;
  symbol: string;
  /** 0-100 composite, from the share of signals voting bullish. */
  score: number;
  bullish: number;
  total: number;
  price: number;
  changePct: number;
  momentum20: number;
  /** Groups this ticker belongs to, e.g. ["MAG7", "SEMI"]. */
  groups: string[];
}

/**
 * Composite strength, 0-100.
 *
 * Nine signals give ten possible values, so this is a coarse score by
 * construction. It is deliberately not smoothed into something that looks more
 * precise than it is — a 78 and an 89 are one signal apart, not eleven points
 * apart in any meaningful sense.
 */
export function strengthScore(bullish: number, total: number): number {
  if (total <= 0) return 50;
  return Math.round((bullish / total) * 100);
}

/** How many of the three dots to fill, from the underlying vote count. */
export function strengthDots(bullish: number, total: number): 1 | 2 | 3 {
  if (total <= 0) return 2;
  const share = bullish / total;
  if (share >= 0.7) return 3;
  if (share >= 0.4) return 2;
  return 1;
}

function membershipIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const group of GROUPS) {
    for (const symbol of group.symbols) {
      const existing = index.get(symbol);
      if (existing) existing.push(group.name);
      else index.set(symbol, [group.name]);
    }
  }
  return index;
}

export function rankTickers(snapshot: GroupsSnapshot): RankedTicker[] {
  const membership = membershipIndex();

  // A symbol can sit in several groups — NVDA is in both MAG7 and SEMI — but
  // its score is identical either way, since it comes from one set of bars.
  const unique = new Map<string, TickerScore>();
  for (const group of snapshot.groups) {
    for (const member of group.members) {
      if (!unique.has(member.symbol)) unique.set(member.symbol, member);
    }
  }

  return [...unique.values()]
    .sort((a, b) => {
      const byScore =
        strengthScore(b.bullish, b.total) - strengthScore(a.bullish, a.total);
      if (byScore !== 0) return byScore;
      // Ties are common with ten possible scores; momentum separates them.
      const byMomentum = (b.momentum20 ?? 0) - (a.momentum20 ?? 0);
      if (byMomentum !== 0) return byMomentum;
      return a.symbol.localeCompare(b.symbol);
    })
    .map((m, i) => ({
      rank: i + 1,
      symbol: m.symbol,
      score: strengthScore(m.bullish, m.total),
      bullish: m.bullish,
      total: m.total,
      price: m.price,
      changePct: m.changePct,
      momentum20: m.momentum20 ?? 0,
      groups: membership.get(m.symbol) ?? [],
    }));
}

/** `LEADERS` / `LAGGARDS` split, guarding against short universes overlapping. */
export function splitLeadersLaggards(
  ranked: RankedTicker[],
  size = 10,
): { leaders: RankedTicker[]; laggards: RankedTicker[] } {
  // With fewer than 2n names the two lists would share members, which would
  // show the same ticker as both a leader and a laggard.
  const take = Math.min(size, Math.floor(ranked.length / 2));
  return {
    leaders: ranked.slice(0, take),
    laggards: ranked.slice(ranked.length - take).reverse(),
  };
}

/** CSV of the full ranking, for the export button. */
export function toCsv(ranked: RankedTicker[]): string {
  const header = 'rank,ticker,score,signals,price,change_pct,momentum_20d,groups';
  const rows = ranked.map((r) =>
    [
      r.rank,
      r.symbol,
      r.score,
      `${r.bullish}/${r.total}`,
      r.price.toFixed(2),
      (r.changePct * 100).toFixed(2),
      (r.momentum20 * 100).toFixed(2),
      `"${r.groups.join(' ')}"`,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** Plain ticker list, newline separated, for the copy button. */
export function toPlainList(ranked: RankedTicker[]): string {
  return ranked.map((r) => r.symbol).join('\n');
}
