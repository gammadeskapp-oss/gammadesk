import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { getForecastPositioning } from '../positioning';
import { marketToday } from '../time';
import { fetchBars } from '../ticker/bars';
import { logReturns, realisedVol } from '../ticker/indicators';
import { buildDrift } from './drift';
import { buildMagnetField } from './magnets';
import { simulate } from './simulate';
import type { ForecastResult } from './types';

/** Drawdown counted as a crash. */
const CRASH_THRESHOLD = 0.08;
/** Sessions of real price shown to the left of the cone. */
const HISTORY_DAYS = 90;

async function build(): Promise<ForecastResult> {
  const [positioning, series] = await Promise.all([
    getForecastPositioning(),
    fetchBars(config.symbol),
  ]);

  const bars = series.bars;
  const closes = bars.map((b) => b.close);

  // Volatility from the last 20 sessions of realised moves.
  const volatility = realisedVol(logReturns(closes).slice(-20));

  const drift = buildDrift(bars);
  const magnets = buildMagnetField(positioning);

  const spot = positioning.spot;
  const horizon = config.forecastHorizon;

  const result = simulate({
    spot,
    volatility,
    annualDrift: drift.annualDrift,
    horizon,
    paths: config.forecastPaths,
    magnets,
    crashThreshold: CRASH_THRESHOLD,
    // Seeded from the quote timestamp so the same snapshot always produces the
    // same cone — a forecast that changed on every refresh would look like new
    // information when nothing had happened.
    seed: Math.floor(new Date(positioning.meta.quoteDateIso).getTime() / 1000) >>> 0,
  });

  const notes: string[] = [...positioning.meta.notes];

  const furthest = magnets.length > 0 ? magnets[magnets.length - 1].tradingDay : 0;
  if (furthest < horizon) {
    notes.push(
      `Listed expirations reach ${furthest} trading days out; beyond that the paths widen on volatility alone, with no positioning to shape them.`,
    );
  }
  if (result.bendSaturation > 25) {
    notes.push(
      `The magnet pull hit its ${(0.3).toFixed(1)}-sigma cap on ${result.bendSaturation.toFixed(0)}% of simulated days, so positioning is being held back from dominating the paths.`,
    );
  }

  /*
   * The bar series ends at the last completed session, but the cone starts
   * from the live spot, which is usually a different number. Left alone the
   * history line stops short and the cone begins somewhere else, with a
   * visible jump at the join. Pinning the final point to spot closes that gap
   * and is also the more accurate thing to draw — it is the current price.
   */
  const history = bars.slice(-HISTORY_DAYS).map((b) => ({ date: b.date, close: b.close }));
  const today = marketToday();
  if (history.length > 0 && history[history.length - 1].date === today) {
    history[history.length - 1] = { date: today, close: spot };
  } else {
    history.push({ date: today, close: spot });
  }

  return {
    symbol: config.symbol,
    spot,
    volatility,
    drift,
    paths: config.forecastPaths,
    horizon,
    bands: result.bands,
    odds: result.odds,
    crashPct: result.crashPct,
    crashThresholdPct: CRASH_THRESHOLD * 100,
    magnets,
    history,
    regime: positioning.summary.regime,
    netGex: positioning.summary.netGex,
    gammaFlip: positioning.summary.flipLevel,
    asOfLabel: positioning.meta.asOfLabel,
    quoteDateLabel: positioning.meta.quoteDateLabel,
    source: positioning.meta.sourceLabel,
    cacheSeconds: config.forecastCacheSeconds,
    notes,
  };
}

/** Cached forecast. Re-simulating is cheap; refetching the chain is not. */
export function getForecast(): Promise<ForecastResult> {
  return cached(
    `forecast:${config.symbol}:${config.forecastHorizon}:${config.forecastPaths}`,
    config.forecastCacheSeconds,
    build,
  );
}
