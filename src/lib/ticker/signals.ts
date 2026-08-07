import {
  latest,
  linearRegression,
  logReturns,
  macd,
  percentileInRange,
  realisedVol,
  rsi,
  sma,
} from './indicators';
import type { Bar, Signal } from './types';

/**
 * The nine directional signals.
 *
 * Each returns exactly one BULLISH or BEARISH vote — there is no neutral. That
 * is a deliberate simplification of a messy reality: a signal sitting on the
 * fence still has to pick a side, so a 5/4 split means "no real edge here", not
 * "slightly bullish". The consensus label reflects that by calling anything
 * near an even split a LEAN rather than a call.
 */

/** Signed percentage, for deltas where the direction is the point. */
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
/** Unsigned magnitude, for prose that already states the direction in words. */
const mag = (v: number) => `${Math.abs(v * 100).toFixed(1)}%`;
const num = (v: number, dp = 2) => v.toFixed(dp);

/** 1. Price trend — where price sits against its 50- and 200-day averages. */
function priceTrend(bars: Bar[]): Signal {
  const closes = bars.map((b) => b.close);
  const price = closes[closes.length - 1];
  const ma50 = latest(sma(closes, 50));
  const ma200 = latest(sma(closes, 200));

  const above50 = ma50 !== null && price > ma50;
  // With under 200 sessions of history the long average does not exist yet;
  // the 50-day then carries the vote on its own.
  const above200 = ma200 !== null ? price > ma200 : above50;

  const vote = above50 && above200 ? 'bullish' : !above50 && !above200 ? 'bearish' : above200 ? 'bullish' : 'bearish';

  const parts: string[] = [];
  if (ma50 !== null) parts.push(`50d ${num(ma50)}`);
  if (ma200 !== null) parts.push(`200d ${num(ma200)}`);

  const reason =
    above50 && above200
      ? 'Price is above both its 50-day and 200-day averages — the trend is up on both timeframes.'
      : !above50 && !above200
        ? 'Price is below both its 50-day and 200-day averages — the trend is down on both timeframes.'
        : above200
          ? 'Price is below its 50-day average but still above the 200-day — a pullback inside a longer uptrend.'
          : 'Price is above its 50-day average but still below the 200-day — a bounce inside a longer downtrend.';

  return {
    id: 'price-trend',
    name: 'Price trend',
    vote,
    reason,
    detail: `price ${num(price)} · ${parts.join(' · ') || 'insufficient history'}`,
  };
}

/** 2. Momentum — 20-session rate of change. */
function momentum(bars: Bar[]): Signal {
  const closes = bars.map((b) => b.close);
  const lookback = Math.min(20, closes.length - 1);
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - lookback];
  const roc = then > 0 ? now / then - 1 : 0;
  const vote = roc > 0 ? 'bullish' : 'bearish';

  return {
    id: 'momentum',
    name: 'Momentum',
    vote,
    reason:
      roc > 0
        ? `Up ${mag(roc)} over the last ${lookback} sessions — buyers have had the upper hand recently.`
        : `Down ${mag(roc)} over the last ${lookback} sessions — sellers have had the upper hand recently.`,
    detail: `${lookback}-day change ${pct(roc)}`,
  };
}

/** 3. Trend quality — direction and orderliness of a 60-session regression. */
function trendQuality(bars: Bar[]): Signal {
  const window = bars.slice(-60).map((b) => Math.log(b.close));
  const { slope, r2 } = linearRegression(window);
  const vote = slope > 0 ? 'bullish' : 'bearish';

  // Slope is a per-day log return; annualise it for something readable.
  const annualised = Math.exp(slope * 252) - 1;
  const orderly = r2 >= 0.5 ? 'orderly' : r2 >= 0.2 ? 'choppy' : 'very noisy';
  const article = /^[aeiou]/i.test(orderly) ? 'An' : 'A';

  return {
    id: 'trend-quality',
    name: 'Trend quality',
    vote,
    reason:
      r2 < 0.2
        ? `The 60-day trend points ${slope > 0 ? 'up' : 'down'} but is very noisy, so read this one loosely.`
        : `${article} ${orderly} ${slope > 0 ? 'up' : 'down'} trend over 60 sessions — ${(r2 * 100).toFixed(0)}% of the move is trend rather than noise.`,
    detail: `R² ${num(r2)} · slope ${pct(annualised)}/yr annualised`,
  };
}

/** 4. Volatility envelope — current 20-day vol against its own 6-month range. */
function volatilityEnvelope(bars: Bar[]): Signal {
  const closes = bars.map((b) => b.close);
  const returns = logReturns(closes);

  const current = realisedVol(returns.slice(-20));

  // Rolling 20-day vol across the last six months, for the comparison range.
  const history: number[] = [];
  const span = Math.min(126, returns.length - 20);
  for (let i = 0; i < span; i += 1) {
    const end = returns.length - i;
    history.push(realisedVol(returns.slice(end - 20, end)));
  }

  const min = Math.min(...history);
  const max = Math.max(...history);
  const position = percentileInRange(current, min, max);

  // Calm tape favours drift; expanding volatility is where damage happens.
  const vote = position < 0.5 ? 'bullish' : 'bearish';

  return {
    id: 'volatility',
    name: 'Volatility envelope',
    vote,
    reason:
      position < 0.5
        ? `Volatility is in the calmer ${(position * 100).toFixed(0)}% of its 6-month range — quiet tape, which tends to favour drift higher.`
        : `Volatility sits in the upper ${(100 - position * 100).toFixed(0)}% of its 6-month range — an agitated tape, where sharp moves cluster.`,
    detail: `20d vol ${(current * 100).toFixed(1)}% · range ${(min * 100).toFixed(1)}–${(max * 100).toFixed(1)}%`,
  };
}

/** 5. RSI regime — 14-day RSI either side of the midline. */
function rsiRegime(bars: Bar[]): Signal {
  const value = latest(rsi(bars.map((b) => b.close), 14)) ?? 50;
  const vote = value > 50 ? 'bullish' : 'bearish';

  const extra =
    value >= 70
      ? ' It is also overbought, which can precede a pause.'
      : value <= 30
        ? ' It is also oversold, which can precede a bounce.'
        : '';

  return {
    id: 'rsi',
    name: 'RSI regime',
    vote,
    reason:
      (value > 50
        ? `RSI at ${num(value, 0)} is above the 50 midline — gains have outweighed losses over the last fortnight.`
        : `RSI at ${num(value, 0)} is below the 50 midline — losses have outweighed gains over the last fortnight.`) + extra,
    detail: `14-day RSI ${num(value, 1)}`,
  };
}

/** 6. MACD — where the MACD line sits against its signal line. */
function macdCross(bars: Bar[]): Signal {
  const series = macd(bars.map((b) => b.close));
  const line = latest(series.macd);
  const signal = latest(series.signal);
  const hist = line !== null && signal !== null ? line - signal : 0;
  const vote = hist > 0 ? 'bullish' : 'bearish';

  // How long the current state has held, for a sense of freshness.
  let bars_since = 0;
  for (let i = series.histogram.length - 1; i >= 0; i -= 1) {
    const h = series.histogram[i];
    if (h === null || (h > 0) !== (hist > 0)) break;
    bars_since += 1;
  }

  return {
    id: 'macd',
    name: 'MACD',
    vote,
    reason:
      hist > 0
        ? `MACD is above its signal line and has been for ${bars_since} session${bars_since === 1 ? '' : 's'} — medium-term momentum is positive.`
        : `MACD is below its signal line and has been for ${bars_since} session${bars_since === 1 ? '' : 's'} — medium-term momentum is negative.`,
    detail: `histogram ${hist >= 0 ? '+' : ''}${num(hist, 3)}`,
  };
}

/** 7. Higher highs / higher lows over the last 20 sessions. */
function structure(bars: Bar[]): Signal {
  const recent = bars.slice(-10);
  const prior = bars.slice(-20, -10);

  if (prior.length === 0) {
    return {
      id: 'structure',
      name: 'Higher highs / lows',
      vote: 'bearish',
      reason: 'Not enough history to compare recent structure.',
      detail: 'insufficient data',
    };
  }

  const recentHigh = Math.max(...recent.map((b) => b.high));
  const recentLow = Math.min(...recent.map((b) => b.low));
  const priorHigh = Math.max(...prior.map((b) => b.high));
  const priorLow = Math.min(...prior.map((b) => b.low));

  const higherHigh = recentHigh > priorHigh;
  const higherLow = recentLow > priorLow;

  let vote: Signal['vote'];
  let reason: string;

  if (higherHigh && higherLow) {
    vote = 'bullish';
    reason = 'The last 10 sessions made both a higher high and a higher low than the 10 before — textbook uptrend structure.';
  } else if (!higherHigh && !higherLow) {
    vote = 'bearish';
    reason = 'The last 10 sessions made both a lower high and a lower low than the 10 before — textbook downtrend structure.';
  } else {
    // One up, one down: a range. Break the tie on where the range centre moved.
    const recentMid = (recentHigh + recentLow) / 2;
    const priorMid = (priorHigh + priorLow) / 2;
    vote = recentMid > priorMid ? 'bullish' : 'bearish';
    reason = `Structure is mixed — ${higherHigh ? 'a higher high but a lower low' : 'a lower high but a higher low'}. The range centre has shifted ${recentMid > priorMid ? 'up' : 'down'}.`;
  }

  return {
    id: 'structure',
    name: 'Higher highs / lows',
    vote,
    reason,
    detail: `high ${num(priorHigh)}→${num(recentHigh)} · low ${num(priorLow)}→${num(recentLow)}`,
  };
}

/** 8. Volume trend — 20-session average against the 20 before it. */
function volumeTrend(bars: Bar[]): Signal {
  const recent = bars.slice(-20);
  const prior = bars.slice(-40, -20);

  const avg = (xs: Bar[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b.volume, 0) / xs.length;

  const now = avg(recent);
  const before = avg(prior);
  const change = before > 0 ? now / before - 1 : 0;
  const vote = change > 0 ? 'bullish' : 'bearish';

  return {
    id: 'volume',
    name: 'Volume trend',
    vote,
    reason:
      change > 0
        ? `Average volume is up ${mag(change)} versus the prior 20 sessions — more participation behind the current move.`
        : `Average volume is down ${mag(change)} versus the prior 20 sessions — the current move is drawing less participation.`,
    detail: `20d avg ${(now / 1e6).toFixed(1)}M shares (${pct(change)})`,
  };
}

/** 9. Where price sits inside its 52-week range. */
function rangePosition(bars: Bar[]): Signal {
  const window = bars.slice(-252);
  const high = Math.max(...window.map((b) => b.high));
  const low = Math.min(...window.map((b) => b.low));
  const price = bars[bars.length - 1].close;

  const position = percentileInRange(price, low, high);
  const fromHigh = high > 0 ? price / high - 1 : 0;
  const vote = position > 0.5 ? 'bullish' : 'bearish';

  return {
    id: 'range-position',
    name: '52-week range',
    vote,
    reason:
      position > 0.5
        ? `Trading ${(position * 100).toFixed(0)}% of the way up its 52-week range, ${mag(fromHigh)} below the high — strength tends to persist near highs.`
        : `Trading only ${(position * 100).toFixed(0)}% of the way up its 52-week range, ${mag(fromHigh)} below the high — weakness tends to persist near lows.`,
    detail: `52w ${num(low)} – ${num(high)}`,
  };
}

/** All nine signals, in display order. */
export function computeSignals(bars: Bar[]): Signal[] {
  return [
    priceTrend(bars),
    momentum(bars),
    trendQuality(bars),
    volatilityEnvelope(bars),
    rsiRegime(bars),
    macdCross(bars),
    structure(bars),
    volumeTrend(bars),
    rangePosition(bars),
  ];
}
