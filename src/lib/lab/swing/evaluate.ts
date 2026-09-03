/**
 * The swing candidate check, as a pure function.
 *
 * Client-safe and dependency-free of anything that reaches the network: it
 * takes the readings the server already gathered for one name and turns them
 * into a candidate, an exclusion, or nothing. Keeping it pure is what lets
 * `verify` walk the alignment table without a store or a quote, and it is why
 * the read path in `./index.ts` does all the fetching and none of the deciding.
 *
 * ## Alignment, and the two ways a name leaves the list
 *
 * A name qualifies only when all six mandatory checks pass — no partial credit,
 * no substitute for a missing reading. Beyond that, a set of hard exclusions
 * can remove a name that is otherwise structurally aligned: an actual failing
 * option grade, a report inside the holding window, price run too far past the
 * 20-day average, or no room before the next modeled level. Any one of those
 * removes the name entirely rather than lowering a score, exactly as the brief
 * asks — and when it removes an otherwise-aligned name, the reason is surfaced
 * rather than swallowed.
 *
 * ## Live where it must be, stored where it should be
 *
 * The trend structure, relative strength, the sector reading and the option
 * grade are stored readings on their own refresh cadence. The trigger and the
 * gamma room are recomputed here against the *live* price the caller passes,
 * because those are the two that a quote actually changes — where price sits
 * against the 20-day average and against the next modeled level. Pass a null
 * live price and both fall back to the stored close, with the trigger reported
 * as computed off a stored price rather than a live one.
 */

import type { ConsensusLabel } from '../../sectors/types';
import type { EarningsInfo, Magnet, OptionQuality, ScanRow } from '../../scanner/types';
import {
  BREAKOUT_LOOKBACK,
  CONSOLIDATION_LOOKBACK,
  CONSOLIDATION_MAX_PCT,
  CONSOLIDATION_POSITION,
  EXTENDED_EXCLUDE_PCT,
  HOLDING_WINDOW_DAYS,
  NO_ROOM_PCT,
  RECLAIM_MAX_PCT,
  RS_STRONG,
  SWING_CHECK_KEYS,
  type SwingCandidate,
  type SwingCheck,
  type SwingCheckKey,
  type SwingDirection,
  type SwingExclusion,
  type SwingGammaRoom,
} from './types';

/**
 * The recent close-basis range for the breakout and consolidation triggers.
 *
 * Highs and lows of stored daily *closes*, not intraday prints — the bar shards
 * hold closing prices and nothing finer. `null` throughout when a name has too
 * little history, which leaves those two triggers unevaluated while the reclaim
 * trigger (which needs only the 20-day average) still works.
 */
export interface TriggerContext {
  /** Highest close over the breakout lookback. */
  high: number | null;
  /** Lowest close over the breakout lookback. */
  low: number | null;
  /** Highest close over the (shorter) consolidation lookback. */
  rangeHigh: number | null;
  rangeLow: number | null;
  /** `(rangeHigh − rangeLow) / last close`, percent. Null when short. */
  rangePct: number | null;
}

/** One sector's reading, trimmed to what the check needs. */
export interface SectorReading {
  name: string;
  label: ConsensusLabel;
  /** Five-session change in the sector's average score. Null when short. */
  delta5: number | null;
}

export interface SwingInput {
  row: ScanRow;
  direction: SwingDirection;
  /** SPY's gamma regime, the one market-wide reading. Null when unknown. */
  spyRegime: 'positive' | 'negative' | null;
  /** The sector reading for this name, or null when it could not be mapped. */
  sector: SectorReading | null;
  /** The gamma document's entry for this name, or null when no chain was stored. */
  gamma: { magnets: Magnet[]; flipLevel: number | null } | null;
  /** The recent close-basis range, for breakout and consolidation. */
  trigger: TriggerContext;
  /** Live price when a quote was had; null falls back to the stored close. */
  livePrice: number | null;
}

/** What the evaluation produced. Exactly one of the three is populated. */
export type SwingOutcome =
  | { kind: 'candidate'; candidate: SwingCandidate }
  | { kind: 'excluded'; exclusion: SwingExclusion }
  | { kind: 'none' };

function pctFrom(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return ((to - from) / from) * 100;
}

/** True for a value that is a real, finite number. */
function num(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

// --- the individual checks ---------------------------------------------------

function marketCheck(
  direction: SwingDirection,
  spyRegime: 'positive' | 'negative' | null,
): SwingCheck {
  if (spyRegime === null) {
    return { key: 'market', state: 'unknown', detail: 'no same-day SPY gamma to read' };
  }
  const want = direction === 'bullish' ? 'positive' : 'negative';
  const pass = spyRegime === want;
  return {
    key: 'market',
    state: pass ? 'pass' : 'fail',
    detail:
      direction === 'bullish'
        ? spyRegime === 'positive'
          ? 'SPY gamma positive — market not in breakdown'
          : 'SPY gamma negative — market in breakdown'
        : spyRegime === 'negative'
          ? 'SPY gamma negative — market in breakdown'
          : 'SPY gamma positive — market not in breakdown',
  };
}

function sectorCheck(direction: SwingDirection, sector: SectorReading | null): SwingCheck {
  if (!sector) {
    return { key: 'sector', state: 'unknown', detail: 'no sector reading mapped for this name' };
  }
  const want: ConsensusLabel = direction === 'bullish' ? 'BULLISH' : 'BEARISH';
  const momentumAgrees =
    sector.delta5 === null || (direction === 'bullish' ? sector.delta5 >= 0 : sector.delta5 <= 0);
  const pass = sector.label === want && momentumAgrees;
  const momentum =
    sector.delta5 === null
      ? 'momentum n/a'
      : `momentum ${sector.delta5 >= 0 ? '+' : ''}${sector.delta5.toFixed(1)}/5d`;
  return {
    key: 'sector',
    state: pass ? 'pass' : 'fail',
    detail: `${sector.name}: ${sector.label.toLowerCase()} consensus, ${momentum}`,
  };
}

function trendCheck(direction: SwingDirection, row: ScanRow): SwingCheck {
  const { pctAbove20, pctAbove50, pctAbove200 } = row.metrics;
  if (!num(pctAbove20) || !num(pctAbove50) || !num(pctAbove200)) {
    return {
      key: 'trend',
      state: 'unknown',
      detail: 'not all of the 20/50/200-day averages are available',
    };
  }
  const above = direction === 'bullish';
  const pass = above
    ? pctAbove20 >= 0 && pctAbove50 >= 0 && pctAbove200 >= 0
    : pctAbove20 <= 0 && pctAbove50 <= 0 && pctAbove200 <= 0;
  return {
    key: 'trend',
    state: pass ? 'pass' : 'fail',
    detail: `${above ? 'above' : 'below'} 20/50/200 (${pctAbove20.toFixed(1)}/${pctAbove50.toFixed(
      1,
    )}/${pctAbove200.toFixed(1)}%)`,
  };
}

function rsCheck(direction: SwingDirection, row: ScanRow): SwingCheck {
  const score = row.metrics.rsScore;
  if (!num(score)) {
    return { key: 'rs', state: 'unknown', detail: 'the RS engine could not rank this name' };
  }
  const pass = direction === 'bullish' ? score >= RS_STRONG : score <= 100 - RS_STRONG;
  return { key: 'rs', state: pass ? 'pass' : 'fail', detail: `RS ${Math.round(score)}` };
}

/**
 * The trigger check: any one of three live setups fires it.
 *
 * - **Reclaim** — live price sits just above the 20-day average (0..reclaim
 *   band), i.e. it has pulled back to the average and turned up without running.
 * - **Breakout** — live price has cleared the highest close of the lookback
 *   window, a fresh high against the recent range.
 * - **Consolidation** — the recent close range is tight *and* live price is
 *   pressed into the top of it, coiled and poised.
 *
 * All three are mirrored for a bearish name. Each is checked against the live
 * price; the levels are stored. It is a pass when any fire, and the detail
 * names which — a breakout and a reclaim are different setups and the card
 * should not blur them.
 */
function triggerCheck(
  direction: SwingDirection,
  livePrice: number | null,
  livePctFrom20: number | null,
  ctx: TriggerContext,
): SwingCheck {
  const bull = direction === 'bullish';
  const fired: string[] = [];

  // Reclaim — needs only the 20-day average.
  if (livePctFrom20 !== null) {
    const p = livePctFrom20;
    if (bull ? p > 0 && p <= RECLAIM_MAX_PCT : p < 0 && p >= -RECLAIM_MAX_PCT) {
      fired.push(`reclaimed the 20 EMA (${Math.abs(p).toFixed(1)}% ${p >= 0 ? 'above' : 'below'})`);
    }
  }

  // Breakout — a fresh high (or low) against the recent close range.
  if (livePrice !== null) {
    const edge = bull ? ctx.high : ctx.low;
    if (edge !== null && (bull ? livePrice > edge : livePrice < edge)) {
      fired.push(
        `${bull ? 'breakout above' : 'breakdown below'} the ${BREAKOUT_LOOKBACK}-session ${
          bull ? 'high' : 'low'
        } (${edge.toFixed(2)}, on closes)`,
      );
    }
  }

  // Consolidation — tight range with price pressed to the near edge of it.
  if (
    livePrice !== null &&
    ctx.rangePct !== null &&
    ctx.rangeHigh !== null &&
    ctx.rangeLow !== null &&
    ctx.rangePct <= CONSOLIDATION_MAX_PCT &&
    ctx.rangeHigh > ctx.rangeLow
  ) {
    const pos = (livePrice - ctx.rangeLow) / (ctx.rangeHigh - ctx.rangeLow);
    const nearEdge = bull ? pos >= CONSOLIDATION_POSITION : pos <= 1 - CONSOLIDATION_POSITION;
    if (nearEdge) {
      fired.push(
        `tight range (${ctx.rangePct.toFixed(1)}% over ${CONSOLIDATION_LOOKBACK} sessions), price at the ${
          bull ? 'top' : 'bottom'
        }`,
      );
    }
  }

  if (livePrice === null && livePctFrom20 === null) {
    return {
      key: 'trigger',
      state: 'unknown',
      detail: 'no price or stored levels to test a trigger against',
    };
  }

  if (fired.length > 0) {
    return { key: 'trigger', state: 'pass', detail: fired.join('; ') };
  }
  return {
    key: 'trigger',
    state: 'fail',
    detail: 'no reclaim, breakout or consolidation break against the live price',
  };
}

function volumeCheck(row: ScanRow): SwingCheck {
  const ratio = row.metrics.volumeRatio;
  if (!num(ratio)) {
    return {
      key: 'volume',
      state: 'unknown',
      detail: 'not enough history for a volume baseline',
    };
  }
  return {
    key: 'volume',
    state: ratio >= 1 ? 'pass' : 'fail',
    detail: `recent volume ${ratio.toFixed(2)}× its baseline`,
  };
}

// --- gamma room --------------------------------------------------------------

/**
 * The nearest modeled level in the trade direction, and the room to it.
 *
 * Reuses the stored magnets and flip level exactly as the gamma job wrote them
 * — nothing is recomputed here but the distance, and that against the live
 * price. Shown, never scored: the brief is explicit that a direction must not
 * be inferred from proximity to a level.
 */
function gammaRoom(
  direction: SwingDirection,
  price: number | null,
  gamma: SwingInput['gamma'],
): SwingGammaRoom {
  if (!gamma) {
    return { level: null, levelKind: null, pct: null, note: 'no chain was stored for this name' };
  }
  if (price === null) {
    return { level: null, levelKind: null, pct: null, note: 'no price to measure the room from' };
  }

  const above = direction === 'bullish';
  const candidates: Array<{ level: number; kind: 'magnet' | 'flip' }> = [];
  for (const m of gamma.magnets) {
    if (!num(m.strike)) continue;
    if (above ? m.strike > price : m.strike < price) {
      candidates.push({ level: m.strike, kind: 'magnet' });
    }
  }
  if (gamma.flipLevel !== null && num(gamma.flipLevel)) {
    if (above ? gamma.flipLevel > price : gamma.flipLevel < price) {
      candidates.push({ level: gamma.flipLevel, kind: 'flip' });
    }
  }

  if (candidates.length === 0) {
    return {
      level: null,
      levelKind: null,
      pct: null,
      note: `a chain is stored but no modeled level sits ${above ? 'above' : 'below'} the live price`,
    };
  }

  // Nearest in the trade direction.
  const nearest = candidates.reduce((best, c) =>
    Math.abs(c.level - price) < Math.abs(best.level - price) ? c : best,
  );
  const pct = pctFrom(price, nearest.level);
  return { level: nearest.level, levelKind: nearest.kind, pct, note: null };
}

// --- reused readings: options and earnings -----------------------------------

function readOptions(oq: OptionQuality | null): SwingCandidate['options'] {
  if (!oq) {
    return {
      badge: 'ungraded',
      detail: 'ungraded — click to check',
      elevatedIv: false,
    };
  }
  const elevatedIv =
    oq.reasons.some((r) => r.toLowerCase().includes('elevated')) ||
    (oq.contract?.ivPct !== null && oq.contract?.ivPct !== undefined && oq.contract.ivPct > 80);
  return {
    badge: oq.badge,
    detail: oq.reasons[0] ?? 'graded',
    elevatedIv,
  };
}

function readEarnings(e: EarningsInfo): {
  reading: SwingCandidate['earnings'];
  inside: boolean;
} {
  if (e.state === 'unknown') {
    return {
      reading: { state: 'unknown', detail: 'earnings unknown' },
      inside: false,
    };
  }
  const inside = e.daysAway !== null && e.daysAway >= 0 && e.daysAway <= HOLDING_WINDOW_DAYS;
  if (inside) {
    return {
      reading: {
        state: 'inside',
        detail: `reports in ${e.daysAway} day${e.daysAway === 1 ? '' : 's'} — inside the ${HOLDING_WINDOW_DAYS}-day window`,
      },
      inside: true,
    };
  }
  return {
    reading: {
      state: 'clear',
      detail:
        e.daysAway === null
          ? 'no report inside the holding window'
          : `next report ${e.daysAway} days out — outside the window`,
    },
    inside: false,
  };
}

// --- the evaluation ----------------------------------------------------------

export function evaluateSwing(input: SwingInput): SwingOutcome {
  const { row, direction, spyRegime, sector, gamma } = input;

  const storedPrice = row.price;
  const livePrice = input.livePrice ?? storedPrice;
  const priceSource: 'live' | 'stored' = input.livePrice !== null ? 'live' : 'stored';

  const livePctFrom20 = pctFrom(row.metrics.ema20, livePrice);

  const checks: SwingCheck[] = [
    marketCheck(direction, spyRegime),
    sectorCheck(direction, sector),
    trendCheck(direction, row),
    rsCheck(direction, row),
    triggerCheck(direction, livePrice, livePctFrom20, input.trigger),
    volumeCheck(row),
  ];

  const byKey = new Map<SwingCheckKey, SwingCheck>(checks.map((c) => [c.key, c]));
  const allPass = SWING_CHECK_KEYS.every((k) => byKey.get(k)!.state === 'pass');
  // The structural half — market, sector, trend, RS. A name that clears these
  // but is killed by a hard exclusion is worth naming; one that fails them is
  // simply not aligned and is dropped silently.
  const structuralPass = (['market', 'sector', 'trend', 'rs'] as const).every(
    (k) => byKey.get(k)!.state === 'pass',
  );

  const room = gammaRoom(direction, livePrice, gamma);
  const options = readOptions(row.optionQuality);
  const { reading: earnings, inside: earningsInside } = readEarnings(row.earnings);

  // "Too extended to start from" is a wider bound than the reclaim band, so a
  // genuine breakout that sits above the 20 EMA by more than a reclaim would is
  // not hard-excluded for it. See `EXTENDED_EXCLUDE_PCT`.
  const extended =
    livePctFrom20 !== null &&
    (direction === 'bullish'
      ? livePctFrom20 > EXTENDED_EXCLUDE_PCT
      : livePctFrom20 < -EXTENDED_EXCLUDE_PCT);

  // --- hard exclusions, first applicable wins --------------------------------
  let exclusionReason: string | null = null;
  if (livePrice === null) {
    exclusionReason = 'no price at all, so nothing can be measured';
  } else if (options.badge === 'avoid') {
    exclusionReason = 'option grade is a failing Avoid';
  } else if ((options.badge === 'ungraded' || options.badge === 'unknown') && extended) {
    exclusionReason = 'options quality unknown and price already extended';
  } else if (earningsInside) {
    exclusionReason = earnings.detail;
  } else if (extended) {
    exclusionReason = `price too extended from the 20-day average (${livePctFrom20!.toFixed(1)}%)`;
  } else if (room.level !== null && room.pct !== null && Math.abs(room.pct) < NO_ROOM_PCT) {
    exclusionReason = `no room before the next modeled level (${Math.abs(room.pct).toFixed(1)}%)`;
  }

  if (allPass && exclusionReason === null) {
    const invalidationLevel = row.metrics.ema20;
    const candidate: SwingCandidate = {
      symbol: row.symbol,
      direction,
      sectorName: sector?.name ?? null,
      price: livePrice,
      priceSource,
      storedPrice,
      checks,
      passed: checks.filter((c) => c.state === 'pass').length,
      gammaRoom: room,
      options,
      earnings,
      elevatedIv: options.elevatedIv,
      invalidationLevel,
      invalidationNote:
        invalidationLevel === null
          ? 'no 20-day average stored, so no invalidation level can be stated'
          : direction === 'bullish'
            ? `a close back below the 20-day average (${invalidationLevel.toFixed(2)}) undoes the reclaim`
            : `a close back above the 20-day average (${invalidationLevel.toFixed(2)}) undoes the breakdown`,
    };
    return { kind: 'candidate', candidate };
  }

  if (structuralPass && exclusionReason !== null) {
    return {
      kind: 'excluded',
      exclusion: { symbol: row.symbol, direction, reason: exclusionReason },
    };
  }

  return { kind: 'none' };
}
