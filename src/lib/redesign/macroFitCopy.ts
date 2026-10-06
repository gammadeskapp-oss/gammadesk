import type { MacroAlignment } from './mock';

/**
 * Plain-English wording for the Decision macro-fit box, per category.
 *
 * Pure and separate from the data loader so it can be unit-tested and so the
 * exact sentences live in one place. Never a price target or a call — it names
 * the sensitivity and whether the current backdrop works with or against it.
 *
 * Growth is the rate-sensitive-through-yields category: its read is driven by
 * the direction of 10-year yields (from the macro bias rates driver), not the
 * composite backdrop, because that is what actually moves long-duration names.
 * Financials and real estate (`rate-sensitive`) react to rates in opposite
 * directions, so that category states the caveat rather than asserting a side.
 */

export type YieldDirection = 'rising' | 'falling' | 'flat';
export type Backdrop = 'bullish' | 'bearish' | 'neutral';
export type FitState = 'aligned' | 'neutral' | 'conflicted';

export interface MacroFitCopy {
  /** The category label shown on the "Sensitivity" row. */
  sensitivity: string;
  fit: FitState;
  why: string;
}

const SENSITIVITY: Record<MacroAlignment, string> = {
  growth: 'Growth, rate-sensitive',
  'rate-sensitive': 'Rate-sensitive',
  defensive: 'Defensive',
  cyclical: 'Cyclical, growth-geared',
  'event-risk': 'Earnings inside 24h',
  aligned: 'No strong macro tilt',
  conflicted: 'No strong macro tilt',
};

export function macroFitCopy(args: {
  category: MacroAlignment;
  backdrop: Backdrop;
  yields: YieldDirection;
}): MacroFitCopy {
  const { category, backdrop, yields } = args;
  const sensitivity = SENSITIVITY[category];
  const riskOn = backdrop === 'bullish';
  const riskOff = backdrop === 'bearish';

  if (category === 'growth') {
    const fit: FitState = yields === 'rising' ? 'conflicted' : yields === 'falling' ? 'aligned' : 'neutral';
    const tail =
      yields === 'rising'
        ? 'Yields are rising right now, which is usually a headwind.'
        : yields === 'falling'
          ? 'Yields are falling right now, which usually helps.'
          : 'Yields are flat right now, so rates are not pushing it either way.';
    return { sensitivity, fit, why: `Growth stock: tends to move with interest rates. ${tail}` };
  }

  if (category === 'defensive') {
    const fit: FitState = riskOff ? 'aligned' : riskOn ? 'conflicted' : 'neutral';
    const why = riskOff
      ? 'Defensive: tends to hold up when the backdrop sours, and it is leaning risk-off right now.'
      : riskOn
        ? 'Defensive: tends to lag when risk is on, and the backdrop is leaning risk-on right now.'
        : 'Defensive: no strong macro push either way right now.';
    return { sensitivity, fit, why };
  }

  if (category === 'cyclical') {
    const fit: FitState = riskOn ? 'aligned' : riskOff ? 'conflicted' : 'neutral';
    const why = riskOn
      ? 'Cyclical, growth-geared: geared to growth, and the backdrop is leaning risk-on right now.'
      : riskOff
        ? 'Cyclical, growth-geared: geared to growth, and the backdrop is leaning risk-off, which works against it.'
        : 'Cyclical, growth-geared: no strong macro push either way right now.';
    return { sensitivity, fit, why };
  }

  if (category === 'rate-sensitive') {
    return {
      sensitivity,
      fit: 'neutral',
      why: 'Rate-sensitive: banks and real estate react to the rate outlook, often in opposite directions — read it against the specific name.',
    };
  }

  if (category === 'event-risk') {
    return {
      sensitivity,
      fit: 'neutral',
      why: 'Reports inside the next 24 hours — the print is a nearer risk than the macro backdrop.',
    };
  }

  // aligned / conflicted — no sector tilt to speak to.
  return {
    sensitivity,
    fit: 'neutral',
    why: 'No strong macro tilt for or against this name right now — the setup stands on its own.',
  };
}
