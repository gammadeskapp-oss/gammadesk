/**
 * The per-ticker Research Plan — the existing readings packaged as
 * conditions → confirmation → invalidation, plus the gamma context and the
 * event risk. Neutral throughout: it states what is true, what would confirm
 * the setup, and what would break it. There are no orders, no sizing, no
 * targets.
 *
 * Pure and feed-free: it reads a `Daily20Entry` and whatever gamma/sector/risk
 * context the caller has, and returns a structured plan the Leader Card and the
 * Decision page render the same way.
 */

import type { Daily20Entry } from './daily20';
import type { GammaContext, RiskContext } from './daily20Reason';
import type { SectorConfirm } from './sectorConfirmation';

export interface ResearchPlan {
  /** Why it is strong (bullish) or weak (bearish), as facts. */
  conditions: string[];
  /** The one thing that would confirm the setup is working. */
  confirmation: string;
  /** The level and the plain-English line for where the thesis is wrong. */
  invalidation: { level: number | null; pct: number | null; text: string };
  /** Dealer-gamma context in the SPY-page wording, plus room to the relevant level. */
  gamma: string;
  /** The next dated risk, always stated. */
  eventRisk: string;
}

export interface ResearchPlanContext {
  spot: number | null;
  gamma?: GammaContext | null;
  sector?: SectorConfirm | null;
  risk?: RiskContext | null;
}

function regimePhrase(regime: 'positive' | 'negative' | null): string {
  if (regime === 'positive') return 'Positive gamma — dealer hedging tends to damp its moves';
  if (regime === 'negative') return 'Negative gamma — dealer hedging tends to amplify its moves';
  return 'Dealer positioning not measured';
}

function conditionsFor(entry: Daily20Entry, ctx: ResearchPlanContext): string[] {
  const m = entry.row.metrics;
  const out: string[] = [];
  const bull = entry.direction === 'bullish';

  if (entry.rsPercentiles) {
    const p = entry.rsPercentiles;
    const vals = [p.m1, p.m3, p.m6].filter((v): v is number => v !== null).map((v) => Math.round(v));
    if (vals.length)
      out.push(
        `${bull ? 'Outperforming' : 'Lagging'} the index — RS percentiles ${vals.join(' / ')}.`,
      );
  }
  if (m.pctAbove50 !== null && m.pctAbove200 !== null) {
    out.push(
      `${m.pctAbove50 >= 0 ? 'Above' : 'Below'} its 50-day and ${m.pctAbove200 >= 0 ? 'above' : 'below'} its 200-day.`,
    );
  }
  if (m.pctAboveVwap !== null) {
    out.push(`${Math.abs(m.pctAboveVwap).toFixed(1)}% ${m.pctAboveVwap >= 0 ? 'above' : 'below'} its 20-session VWAP.`);
  }
  if (ctx.sector) {
    out.push(
      `${ctx.sector.sectorName} ranks #${ctx.sector.sectorRank} of ${ctx.sector.of}${
        ctx.sector.verdict === 'confirm' ? ' — the group confirms' : ctx.sector.verdict === 'conflict' ? ' — the group conflicts' : ''
      }.`,
    );
  }
  return out;
}

function confirmationFor(entry: Daily20Entry): string {
  if (entry.direction === 'bullish') {
    switch (entry.setup) {
      case 'breaking-out':
        return 'Holds above the breakout on a close, with volume behind it.';
      case 'pullback':
        return 'Reclaims and holds the 21-day average rather than losing it.';
      case 'extended':
        return 'Pauses or pulls back to the 20-day before the next attempt — do not chase here.';
      default:
        return 'A fresh push through its recent range, on a close.';
    }
  }
  switch (entry.setup) {
    case 'breaking-down':
      return 'Holds below the breakdown on a close, with volume behind it.';
    case 'stretched':
      return 'A bounce that fails at the 20-day before the next leg — do not chase here.';
    default:
      return 'A fresh break below its recent range, on a close.';
  }
}

function invalidationFor(entry: Daily20Entry, spot: number | null): ResearchPlan['invalidation'] {
  const m = entry.row.metrics;
  // The structural line: the 50-day average, the level that defines the trend.
  const level = m.ema50;
  const pct = level !== null && spot !== null && spot > 0 ? ((spot - level) / spot) * 100 : null;
  if (entry.direction === 'bullish') {
    return {
      level,
      pct,
      text:
        level === null
          ? 'A decisive close back below its 50-day average would break the leadership read.'
          : `A decisive close below the 50-day (~${level.toFixed(2)}${pct !== null ? `, ${Math.abs(pct).toFixed(1)}% away` : ''}) would break the leadership read.`,
    };
  }
  return {
    level,
    pct,
    text:
      level === null
        ? 'A decisive close back above its 50-day average would break the breakdown read.'
        : `A decisive close above the 50-day (~${level.toFixed(2)}${pct !== null ? `, ${Math.abs(pct).toFixed(1)}% away` : ''}) would break the breakdown read.`,
  };
}

function gammaFor(entry: Daily20Entry, ctx: ResearchPlanContext): string {
  const g = ctx.gamma;
  const regime = regimePhrase(g?.regime ?? entry.row.regime);
  if (!g) return `${regime}.`;
  const magnet = entry.direction === 'bullish' ? g.upsideMagnet : g.downsideMagnet;
  const side = entry.direction === 'bullish' ? 'upside magnet' : 'downside magnet';
  if (magnet === null) return `${regime}.`;
  const room = g.roomPct !== null ? ` ~${Math.abs(g.roomPct).toFixed(0)}% of room to the ${side} at ${magnet}` : ` ${side} at ${magnet}`;
  return `${regime} —${room}.`;
}

function eventRiskFor(entry: Daily20Entry, ctx: ResearchPlanContext): string {
  if (ctx.risk && ctx.risk.label) {
    return ctx.risk.daysAway !== null
      ? `${ctx.risk.label} in ${ctx.risk.daysAway}d.`
      : `${ctx.risk.label} ahead (date unknown).`;
  }
  const e = entry.row.earnings;
  if (e.state === 'known' && e.daysAway !== null) return `Earnings in ${e.daysAway}d.`;
  return 'No dated event flagged — re-check against your own calendar.';
}

export function researchPlan(entry: Daily20Entry, ctx: ResearchPlanContext = { spot: null }): ResearchPlan {
  return {
    conditions: conditionsFor(entry, ctx),
    confirmation: confirmationFor(entry),
    invalidation: invalidationFor(entry, ctx.spot ?? entry.row.price),
    gamma: gammaFor(entry, ctx),
    eventRisk: eventRiskFor(entry, ctx),
  };
}
