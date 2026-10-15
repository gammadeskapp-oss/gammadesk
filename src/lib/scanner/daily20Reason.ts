/**
 * "Why this is here today" — the structured, plain-English case for a name's
 * place in the Daily 20, in both a bullish and a bearish form.
 *
 * Built for the Decision page's top section (ship-order step 7) but kept here,
 * pure and feed-free, so the same words can be reused on the Leader Card and so
 * it can be tested without a page. It takes a `Daily20Entry` plus whatever
 * context the caller has wired (RS percentiles, sector standing, gamma levels,
 * the next risk event) and returns a title and an ordered list of lines. Any
 * line whose context is absent is simply omitted — the account is honest about
 * what it could say rather than inventing it.
 *
 * ## It describes conditions, never actions
 *
 * Every line states a condition — where it ranks, how its relative strength
 * reads, where price sits against its averages, what today's setup is, the
 * dealer-gamma context and the room to the nearest level, and the risk event.
 * None of them says to buy, sell, or hold, and the risk line is always present:
 * a case with nothing to watch is a case that has not been read carefully.
 */

import type { Daily20Entry } from './daily20';
import { SETUP_LABEL } from './daily20';
import type { RsWindows } from './daily20Gate';

/** The gamma levels for a name, in the SPY-page's vocabulary. */
export interface GammaContext {
  regime: 'positive' | 'negative' | null;
  flip: number | null;
  /** The upside magnet / call wall. */
  upsideMagnet: number | null;
  /** The downside magnet / put wall. */
  downsideMagnet: number | null;
  /** Percent of room to the relevant magnet for this direction. */
  roomPct: number | null;
}

/** The nearest dated risk, for the always-present watch line. */
export interface RiskContext {
  /** e.g. "Earnings" or "CPI". */
  label: string | null;
  /** Calendar days away, or null when unknown. */
  daysAway: number | null;
}

export interface ReasonContext {
  rsPercentiles?: RsWindows | null;
  sectorName?: string | null;
  /** 1-based sector rank and how many sectors, e.g. 2 of 11. */
  sectorRank?: { rank: number; of: number } | null;
  gamma?: GammaContext | null;
  risk?: RiskContext | null;
}

export interface WhyHere {
  title: string;
  lines: string[];
  /** The single always-present risk/watch line, also exposed on its own. */
  watch: string;
}

function regimePhrase(regime: 'positive' | 'negative' | null): string | null {
  if (regime === 'positive') {
    return 'positive gamma — dealer hedging tends to damp its moves';
  }
  if (regime === 'negative') {
    return 'negative gamma — dealer hedging tends to amplify its moves';
  }
  return null;
}

function rsLine(direction: Daily20Entry['direction'], p: RsWindows | null | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  const add = (label: string, v: number | null) => {
    if (v !== null && Number.isFinite(v)) parts.push(`${label} ${Math.round(v)}`);
  };
  add('1M', p.m1);
  add('3M', p.m3);
  add('6M', p.m6);
  if (parts.length === 0) return null;
  const verb = direction === 'bullish' ? 'Outperforming' : 'Lagging';
  const rel = direction === 'bullish' ? 'above' : 'below';
  return `${verb} the index — RS percentiles ${rel} the pack at ${parts.join(' / ')}.`;
}

function maPostureLine(entry: Daily20Entry): string | null {
  const m = entry.row.metrics;
  const bits: string[] = [];
  if (m.pctAbove50 !== null) bits.push(`${m.pctAbove50 >= 0 ? 'above' : 'below'} its 50-day`);
  if (m.pctAbove200 !== null) bits.push(`${m.pctAbove200 >= 0 ? 'above' : 'below'} its 200-day`);
  if (m.ema50 !== null && m.ema200 !== null) bits.push(m.ema50 >= m.ema200 ? '50 above 200' : '50 below 200');
  if (bits.length === 0) return null;
  const subject = entry.direction === 'bullish' ? 'Price' : 'Price';
  return `${subject} ${bits.join(', ')}.`;
}

function gammaLine(dir: Daily20Entry['direction'], g: GammaContext | null | undefined): string | null {
  if (!g) return null;
  const regime = regimePhrase(g.regime);
  const magnet = dir === 'bullish' ? g.upsideMagnet : g.downsideMagnet;
  const side = dir === 'bullish' ? 'upside magnet' : 'downside magnet';
  const roomPart =
    g.roomPct !== null && magnet !== null
      ? ` ~${Math.abs(g.roomPct).toFixed(0)}% of room to the ${side} at ${magnet}`
      : magnet !== null
        ? ` ${side} at ${magnet}`
        : '';
  if (!regime && !roomPart) return null;
  return `${regime ?? 'Gamma context unread'}${roomPart ? ` —${roomPart}.` : '.'}`;
}

function watchLine(entry: Daily20Entry, risk: RiskContext | null | undefined): string {
  const bits: string[] = [];
  // The setup caution, where there is one.
  if (entry.setup === 'extended') bits.push('extended above its 20-day — a worse place to start from');
  else if (entry.setup === 'stretched') bits.push('stretched below its 20-day — prone to a snap-back');
  // The dated risk.
  if (risk && risk.label) {
    bits.push(
      risk.daysAway !== null ? `${risk.label} in ${risk.daysAway}d` : `${risk.label} ahead (date unknown)`,
    );
  }
  if (bits.length === 0) return 'Watch: nothing dated flagged — re-check against your own levels.';
  return `Watch: ${bits.join('; ')}.`;
}

/**
 * The full "Why this is here today" for one entry.
 *
 * The title carries the direction, rank and the honest two-axis label; the
 * lines carry the evidence; the watch line is always last and always present.
 */
export function whyHereToday(entry: Daily20Entry, ctx: ReasonContext = {}): WhyHere {
  const side = entry.direction === 'bullish' ? 'leader' : 'laggard';
  const title = `#${entry.rank} ${side} today — ${entry.leadership} · ${entry.display}`;

  const lines: string[] = [];

  const rs = rsLine(entry.direction, ctx.rsPercentiles);
  if (rs) lines.push(rs);

  if (ctx.sectorName) {
    const rank = ctx.sectorRank ? `, rank ${ctx.sectorRank.rank} of ${ctx.sectorRank.of}` : '';
    lines.push(`Group: ${ctx.sectorName}${rank}.`);
  }

  const ma = maPostureLine(entry);
  if (ma) lines.push(ma);

  lines.push(`Today's setup: ${SETUP_LABEL[entry.setup].toLowerCase()}.`);

  const gamma = gammaLine(entry.direction, ctx.gamma);
  if (gamma) lines.push(gamma);

  const watch = watchLine(entry, ctx.risk);
  lines.push(watch);

  return { title, lines, watch };
}
