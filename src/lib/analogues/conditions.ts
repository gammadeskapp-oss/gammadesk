import { rsi, sma } from '../ticker/indicators';
import type { Bar, ConditionDef, ConditionId } from './types';

/**
 * The eight conditions, as pure functions over a daily bar series.
 *
 * ## What a condition is, and is not
 *
 * Each one fires on the close that *completes* it and on no other bar. That is
 * the whole discipline of this file. A three-down-days condition that fired on
 * every bar of a five-day slide would report four matches for one event, and
 * every statistic downstream would inherit the double count. So the streak
 * conditions fire on the third down close only; the crossing conditions fire
 * on the crossing bar only; and the threshold conditions fire on the bar that
 * crosses in, never on the bars that stay there.
 *
 * That distinction is why this module is pure and driven by `verify:analogues`
 * with hand-built series: the off-by-one that would inflate every match count
 * is invisible in a rendered table and obvious in a fixture.
 *
 * Nothing here computes a return. Detectors produce indices; `forward.ts`
 * recomputes outcomes on read, so a match date can never carry a stale return
 * beside it.
 */

/*
 * `label` is what the reader sees and is written for someone who has never
 * traded; `rule` beneath it carries the exact definition. Ids are never
 * touched — they are in URLs — and neither is anything the detectors read.
 */
export const CONDITIONS: ConditionDef[] = [
  {
    id: 'down-3', family: 'consecutive-down', label: '3 consecutive down closes',
    rule: 'Third straight close below the previous close.', warmup: 4,
  },
  {
    id: 'down-4', family: 'consecutive-down', label: '4 consecutive down closes',
    rule: 'Fourth straight close below the previous close.', warmup: 5,
  },
  {
    id: 'down-5', family: 'consecutive-down', label: '5 consecutive down closes',
    rule: 'Fifth straight close below the previous close.', warmup: 6,
  },
  {
    id: 'up-3', family: 'consecutive-up', label: '3 consecutive up closes',
    rule: 'Third straight close above the previous close.', warmup: 4,
  },
  {
    id: 'up-4', family: 'consecutive-up', label: '4 consecutive up closes',
    rule: 'Fourth straight close above the previous close.', warmup: 5,
  },
  {
    id: 'up-5', family: 'consecutive-up', label: '5 consecutive up closes',
    rule: 'Fifth straight close above the previous close.', warmup: 6,
  },
  {
    id: 'dd-3', family: 'drawdown', label: 'Down 3% from its 12-month high',
    rule: 'First close more than 3% below the trailing 52-week high.',
    warmup: 252,
  },
  {
    id: 'dd-5', family: 'drawdown', label: 'Down 5% from its 12-month high',
    rule: 'First close more than 5% below the trailing 52-week high.',
    warmup: 252,
  },
  {
    id: 'dd-10', family: 'drawdown', label: 'Down 10% from its 12-month high',
    rule: 'First close more than 10% below the trailing 52-week high.',
    warmup: 252,
  },
  {
    id: 'rsi-under-30', family: 'rsi', label: 'Momentum drops below 30 (RSI)',
    rule: 'RSI crosses from 30 or above to below 30 on the close.', warmup: 15,
  },
  {
    id: 'rsi-over-70', family: 'rsi', label: 'Momentum rises above 70 (RSI)',
    rule: 'RSI crosses from 70 or below to above 70 on the close.', warmup: 15,
  },
  {
    id: 'ma200-lost', family: 'ma200-lost', label: 'First close below its 200-day average',
    rule: 'Close below the 200-day average after 20 or more closes above it.',
    warmup: 220,
  },
  {
    id: 'ma200-regained', family: 'ma200-regained', label: 'First close above its 200-day average',
    rule: 'Close above the 200-day average after 20 or more closes below it.',
    warmup: 220,
  },
  {
    id: 'bb-lower', family: 'bollinger',
    label: 'Close below its usual range (Bollinger band)',
    rule: 'Close below the 20-day average less two standard deviations, having closed inside the band the day before.',
    warmup: 21,
  },
  {
    id: 'gap-up-1', family: 'gap', label: 'Opened more than 1% above the day before',
    rule: 'Open more than 1% above the previous close.', warmup: 2,
  },
  {
    id: 'gap-down-1', family: 'gap', label: 'Opened more than 1% below the day before',
    rule: 'Open more than 1% below the previous close.', warmup: 2,
  },
];

export function conditionById(id: string): ConditionDef | undefined {
  return CONDITIONS.find((c) => c.id === id);
}

/** Population standard deviation over a window — the Bollinger convention. */
function stdevOver(values: number[], end: number, period: number): number {
  let sum = 0;
  for (let i = end - period + 1; i <= end; i += 1) sum += values[i];
  const mean = sum / period;
  let sq = 0;
  for (let i = end - period + 1; i <= end; i += 1) {
    const d = values[i] - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / period);
}

/** Length of the run of same-direction closes ending at each index. */
function streaks(closes: number[], up: boolean): number[] {
  const out: number[] = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i += 1) {
    const moved = up ? closes[i] > closes[i - 1] : closes[i] < closes[i - 1];
    out[i] = moved ? out[i - 1] + 1 : 0;
  }
  return out;
}

/**
 * Highest close over the trailing `period` sessions, today included.
 *
 * Sessions rather than a true calendar year: the series carries one value per
 * trading day, and counting sessions keeps the window the same size everywhere
 * instead of quietly shrinking it across holiday weeks.
 */
function trailingHigh(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    let hi = -Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (closes[j] > hi) hi = closes[j];
    }
    out[i] = hi;
  }
  return out;
}

/** Sessions in a year, for the 52-week window. */
const YEAR = 252;

/** Every index at which `id` fires, ascending. */
export function detect(bars: Bar[], id: ConditionId): number[] {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const hits: number[] = [];
  if (n === 0) return hits;

  switch (id) {
    case 'down-3': case 'down-4': case 'down-5':
    case 'up-3': case 'up-4': case 'up-5': {
      const up = id.startsWith('up');
      const target = Number(id.slice(-1));
      const run = streaks(closes, up);
      /*
       * Exactly `target`, not "at least". The fourth down day completes down-4
       * and must not also count as a second down-3 — one slide is one event,
       * and the reader chooses which length they are asking about.
       */
      for (let i = 0; i < n; i += 1) if (run[i] === target) hits.push(i);
      return hits;
    }

    case 'dd-3': case 'dd-5': case 'dd-10': {
      const pct = Number(id.slice(3)) / 100;
      const high = trailingHigh(closes, YEAR);
      /*
       * The crossing, not the state. Without the "was not already below"
       * guard, a year-long decline would fire -10% on several hundred
       * consecutive sessions, and one regime would be reported as a regime's
       * worth of independent evidence.
       */
      let below = false;
      for (let i = 0; i < n; i += 1) {
        const h = high[i];
        if (h === null) continue;
        const nowBelow = closes[i] < h * (1 - pct);
        if (nowBelow && !below) hits.push(i);
        below = nowBelow;
      }
      return hits;
    }

    case 'rsi-under-30': case 'rsi-over-70': {
      const series = rsi(closes, 14);
      const under = id === 'rsi-under-30';
      for (let i = 1; i < n; i += 1) {
        const now = series[i];
        const prev = series[i - 1];
        if (now === null || prev === null) continue;
        if (under ? now < 30 && prev >= 30 : now > 70 && prev <= 70) hits.push(i);
      }
      return hits;
    }

    case 'ma200-lost': case 'ma200-regained': {
      const ma = sma(closes, 200);
      const lost = id === 'ma200-lost';
      /*
       * "After 20+ sessions" is a run length counted only over bars where the
       * average exists. A run that began before the average was defined is not
       * credited as time spent on either side.
       */
      let run = 0;
      let side: 'above' | 'below' | null = null;
      for (let i = 0; i < n; i += 1) {
        const avg = ma[i];
        if (avg === null) continue;
        const nowSide: 'above' | 'below' = closes[i] > avg ? 'above' : 'below';
        const flipped = side !== null && nowSide !== side;
        const qualifies =
          flipped && run >= 20 &&
          (lost ? nowSide === 'below' : nowSide === 'above');
        if (qualifies) hits.push(i);
        run = flipped || side === null ? 1 : run + 1;
        side = nowSide;
      }
      return hits;
    }

    case 'bb-lower': {
      const ma = sma(closes, 20);
      for (let i = 20; i < n; i += 1) {
        const mid = ma[i];
        const prevMid = ma[i - 1];
        if (mid === null || prevMid === null) continue;
        const lower = mid - 2 * stdevOver(closes, i, 20);
        const prevLower = prevMid - 2 * stdevOver(closes, i - 1, 20);
        // The bar that leaves the band, not every bar spent outside it.
        if (closes[i] < lower && closes[i - 1] >= prevLower) hits.push(i);
      }
      return hits;
    }

    case 'gap-up-1': case 'gap-down-1': {
      const up = id === 'gap-up-1';
      for (let i = 1; i < n; i += 1) {
        const change = bars[i].open / closes[i - 1] - 1;
        if (up ? change > 0.01 : change < -0.01) hits.push(i);
      }
      return hits;
    }
  }
}
