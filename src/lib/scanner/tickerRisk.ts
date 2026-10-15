/**
 * The ticker-level risk row — the same discipline the SPY Decision page applies
 * to the index, applied to one name: how far to where the thesis breaks, how
 * far to the next level, how much gamma room, what event is coming, whether
 * premiums look rich, and whether you are doubling up on correlated names.
 *
 * Pure. Each item is a reading with a `warn` flag so the row can surface a
 * caution in red as readily as a benign number in grey. Readings that cannot be
 * taken are shown as "—", never guessed. Nothing here is an instruction.
 */

import type { Daily20Entry } from './daily20';
import { researchPlan } from './researchPlan';
import type { GammaContext, RiskContext } from './daily20Reason';
import type { SectorConfirm } from './sectorConfirmation';

export interface RiskItem {
  label: string;
  value: string;
  /** True when this reading is a caution worth flagging. */
  warn: boolean;
}

export interface TickerRiskContext {
  spot: number | null;
  gamma?: GammaContext | null;
  sector?: SectorConfirm | null;
  risk?: RiskContext | null;
  /** Quoted implied vol (percent) from the graded contract, if any. */
  ivPct?: number | null;
}

/** Below this distance to the invalidation level the row flags it as tight. */
export const TIGHT_INVALIDATION_PCT = 3;
/** Below this gamma room the name is effectively pinned against the level. */
export const PINNED_ROOM_PCT = 2;
/** Quoted IV above this reads as rich (a caveat, not a percentile). */
export const RICH_IV_PCT = 40;
/** Peers at or above this count trip the correlation caution. */
export const CORRELATION_PEERS = 3;
/** Event inside this many sessions is flagged. */
export const EVENT_WARN_DAYS = 7;

function fmtPct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : `${Math.abs(v).toFixed(1)}%`;
}

export function tickerRiskRow(entry: Daily20Entry, ctx: TickerRiskContext): RiskItem[] {
  const items: RiskItem[] = [];
  const spot = ctx.spot ?? entry.row.price;

  // 1. Distance to invalidation (the 50-day line, from the research plan).
  const inval = researchPlan(entry, { spot, gamma: ctx.gamma, sector: ctx.sector, risk: ctx.risk }).invalidation;
  items.push({
    label: 'To invalidation',
    value: fmtPct(inval.pct),
    warn: inval.pct !== null && Math.abs(inval.pct) < TIGHT_INVALIDATION_PCT,
  });

  // 2. Next support / resistance, from the modelled gamma levels.
  const g = ctx.gamma;
  if (g && spot !== null && spot > 0) {
    const levels = [g.flip, g.upsideMagnet, g.downsideMagnet].filter(
      (x): x is number => x !== null && Number.isFinite(x),
    );
    const below = levels.filter((l) => l < spot).sort((a, b) => b - a)[0];
    const above = levels.filter((l) => l > spot).sort((a, b) => a - b)[0];
    const near = entry.direction === 'bullish' ? below : above;
    const label = entry.direction === 'bullish' ? 'Support' : 'Resistance';
    if (near !== undefined) {
      const pct = ((spot - near) / spot) * 100;
      items.push({ label, value: `${near} (${fmtPct(pct)})`, warn: false });
    } else {
      items.push({ label, value: '—', warn: false });
    }
  } else {
    items.push({ label: entry.direction === 'bullish' ? 'Support' : 'Resistance', value: '—', warn: false });
  }

  // 3. Gamma room to the relevant magnet.
  const room = g?.roomPct ?? null;
  items.push({
    label: 'Gamma room',
    value: fmtPct(room),
    warn: room !== null && Math.abs(room) < PINNED_ROOM_PCT,
  });

  // 4. Event exposure.
  const risk = ctx.risk;
  const earnings = entry.row.earnings;
  let eventValue = 'none <calendar>';
  let eventWarn = false;
  if (risk && risk.label && risk.daysAway !== null) {
    eventValue = `${risk.label} ${risk.daysAway}d`;
    eventWarn = risk.daysAway <= EVENT_WARN_DAYS;
  } else if (earnings.state === 'known' && earnings.daysAway !== null) {
    eventValue = `Earnings ${earnings.daysAway}d`;
    eventWarn = earnings.daysAway <= EVENT_WARN_DAYS;
  }
  items.push({ label: 'Event', value: eventValue, warn: eventWarn });

  // 5. IV — quoted, flagged rich (a caveat, not a true IV percentile).
  const iv = ctx.ivPct ?? null;
  items.push({
    label: 'IV (quoted)',
    value: iv === null ? '—' : `${iv.toFixed(0)}%${iv > RICH_IV_PCT ? ' · rich' : ''}`,
    warn: iv !== null && iv > RICH_IV_PCT,
  });

  // 6. Correlation — other Daily 20 names in the same sector.
  const peers = ctx.sector?.peers ?? 0;
  if (peers > 0) {
    items.push({
      label: 'Correlation',
      value: `${peers} in ${ctx.sector?.sectorName ?? 'sector'}`,
      warn: peers >= CORRELATION_PEERS,
    });
  }

  return items;
}
