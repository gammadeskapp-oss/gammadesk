/**
 * Sector confirmation for each Daily 20 name — does the name's own group back
 * up its leadership or fight it.
 *
 * Pure: it takes the assembled Daily 20, a per-symbol sector reading (name,
 * rank among sectors, 5-day score change) from the sectors page, and whether
 * each name sits above its 50-day MA, and returns one confirmation per symbol.
 * It adds no data source.
 *
 * The verdict is deliberately two-sided and shows a conflict as readily as a
 * confirmation: a leader in a fading group is a conflict and says so, which is
 * exactly the kind of caution the page exists to surface rather than bury.
 */

import type { Daily20, Daily20Entry } from './daily20';
import type { Direction } from './directionScore';

/** One symbol's sector reading, lifted from the sectors snapshot. */
export interface SectorInfo {
  id: string;
  name: string;
  /** 0-100 sector strength (the nine-signal consensus average). */
  score: number;
  /** 1 = strongest sector today. */
  rank: number;
  /** Total sectors ranked. */
  of: number;
  /** Sector score change vs five sessions ago. Null when history is short. */
  delta5: number | null;
}

export type SectorVerdict = 'confirm' | 'conflict' | 'mixed' | 'unknown';

export interface SectorConfirm {
  sectorName: string;
  sectorRank: number;
  of: number;
  delta5: number | null;
  /** Other Daily 20 names in the same sector (this side + the other). */
  peers: number;
  /** Of this name + its peers, the share above their 50-day MA, 0-100. Null when unknown. */
  pctAbove50: number | null;
  verdict: SectorVerdict;
  /** One plain-English line. */
  line: string;
}

/** Thresholds for calling a sector strong or weak, tunable in one place. */
export const SECTOR_STRONG = 55;
export const SECTOR_WEAK = 45;

function verdictFor(direction: Direction, info: SectorInfo): SectorVerdict {
  const rising = info.delta5 !== null && info.delta5 > 0;
  const falling = info.delta5 !== null && info.delta5 < 0;
  if (direction === 'bullish') {
    if (info.score >= SECTOR_STRONG || rising) return 'confirm';
    if (info.score < SECTOR_WEAK && !rising) return 'conflict';
    return 'mixed';
  }
  if (info.score <= SECTOR_WEAK || falling) return 'confirm';
  if (info.score > SECTOR_STRONG && !falling) return 'conflict';
  return 'mixed';
}

function line(direction: Direction, info: SectorInfo, peers: number, verdict: SectorVerdict): string {
  const side = direction === 'bullish' ? 'leadership' : 'weakness';
  const peerPart = peers > 0 ? ` ${peers} peer${peers === 1 ? '' : 's'} also in the Daily 20.` : '';
  if (verdict === 'confirm') {
    return `${info.name} (#${info.rank} of ${info.of}) confirms the ${side}.${peerPart}`;
  }
  if (verdict === 'conflict') {
    return `${info.name} (#${info.rank} of ${info.of}) conflicts with the ${side} — the group is going the other way.${peerPart}`;
  }
  return `${info.name} (#${info.rank} of ${info.of}) is mixed on the ${side}.${peerPart}`;
}

/**
 * One confirmation per Daily 20 symbol.
 *
 * `above50BySymbol` is read for the name and its sector peers to compute the
 * share of the group participating; a name with no sector reading is left out
 * of the result (its row shows the component and the inline block as "—").
 */
export function buildSectorConfirmations(
  d20: Daily20,
  sectorBySymbol: Map<string, SectorInfo>,
  above50BySymbol: Map<string, boolean | null>,
): Map<string, SectorConfirm> {
  const all: Daily20Entry[] = [...d20.bullish, ...d20.bearish];

  // Group Daily 20 symbols by sector id for the peer counts.
  const bySector = new Map<string, Daily20Entry[]>();
  for (const e of all) {
    const info = sectorBySymbol.get(e.symbol);
    if (!info) continue;
    const bucket = bySector.get(info.id);
    if (bucket) bucket.push(e);
    else bySector.set(info.id, [e]);
  }

  const out = new Map<string, SectorConfirm>();
  for (const e of all) {
    const info = sectorBySymbol.get(e.symbol);
    if (!info) continue;

    const group = bySector.get(info.id) ?? [e];
    const peers = group.length - 1;

    // Share of the name + peers that are above their 50-day MA.
    let measured = 0;
    let above = 0;
    for (const g of group) {
      const a = above50BySymbol.get(g.symbol);
      if (a === null || a === undefined) continue;
      measured += 1;
      if (a) above += 1;
    }
    const pctAbove50 = measured > 0 ? Math.round((above / measured) * 100) : null;

    const verdict = verdictFor(e.direction, info);
    out.set(e.symbol, {
      sectorName: info.name,
      sectorRank: info.rank,
      of: info.of,
      delta5: info.delta5,
      peers,
      pctAbove50,
      verdict,
      line: line(e.direction, info, peers, verdict),
    });
  }

  return out;
}

/**
 * Build the per-symbol sector lookup from a sectors snapshot's shape.
 *
 * Kept here, tolerant of the minimal fields, so the page can hand it the
 * snapshot's sectors (each with id, name, score, delta5 and a member list) and
 * get back both this lookup and the strength map the gate/score consume.
 */
export function sectorLookups(
  sectors: Array<{ id: string; name: string; score: number; delta5: number | null; members: Array<{ symbol: string }> }>,
): { infoBySymbol: Map<string, SectorInfo>; strengthBySymbol: Map<string, number> } {
  const ranked = [...sectors].sort((a, b) => b.score - a.score);
  const of = ranked.length;
  const infoBySymbol = new Map<string, SectorInfo>();
  const strengthBySymbol = new Map<string, number>();

  ranked.forEach((sector, i) => {
    const info: SectorInfo = {
      id: sector.id,
      name: sector.name,
      score: sector.score,
      rank: i + 1,
      of,
      delta5: sector.delta5,
    };
    for (const member of sector.members) {
      infoBySymbol.set(member.symbol, info);
      strengthBySymbol.set(member.symbol, sector.score);
    }
  });

  return { infoBySymbol, strengthBySymbol };
}
