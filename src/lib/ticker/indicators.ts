/**
 * Technical indicators over a daily bar series.
 *
 * Every function returns an array aligned index-for-index with the input, using
 * `null` for leading positions where the indicator is not yet defined. Silently
 * shifting or truncating series is the usual source of off-by-one bugs in this
 * kind of code, so nothing here does that.
 */

/** Simple moving average. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the simple average of the first
 * `period` values — the conventional seeding, and what charting packages use.
 */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index using Wilder's smoothing (not a simple average of
 * the last n changes — that is a different, and wrong, indicator).
 */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

export interface MacdSeries {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/** MACD line, its signal line, and the histogram between them. */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });

  // The signal line is an EMA of the MACD line, which only exists from the
  // slow period onward, so it is computed over the defined tail and mapped back.
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(closes.length).fill(null);

  if (firstDefined >= 0) {
    const tail = macdLine.slice(firstDefined) as number[];
    const tailSignal = ema(tail, signalPeriod);
    for (let i = 0; i < tailSignal.length; i += 1) {
      signal[firstDefined + i] = tailSignal[i];
    }
  }

  const histogram = macdLine.map((m, i) => {
    const s = signal[i];
    return m !== null && s !== null ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}

/** Sample standard deviation. */
export function stdev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (n - 1);
  return Math.sqrt(variance);
}

/** Daily log returns. Length is `closes.length - 1`. */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      out.push(Math.log(closes[i] / closes[i - 1]));
    } else {
      out.push(0);
    }
  }
  return out;
}

/** Annualised realised volatility from a window of daily log returns. */
export function realisedVol(returns: number[]): number {
  return stdev(returns) * Math.sqrt(252);
}

export interface Regression {
  slope: number;
  intercept: number;
  /** Coefficient of determination — how orderly the trend is, 0 to 1. */
  r2: number;
}

/**
 * Least-squares fit of `values` against their index.
 *
 * Run on log prices, the slope is a continuously-compounded return per day and
 * R² measures how much of the move is trend rather than noise.
 */
export function linearRegression(values: number[]): Regression {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    const dy = values[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);

  return { slope, intercept, r2 };
}

/** Last non-null value of an indicator series. */
export function latest(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null) return series[i];
  }
  return null;
}

/** Where `value` sits inside `[min, max]`, as 0..1. */
export function percentileInRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
