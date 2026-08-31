import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { peekBreadth } from '../groups';
import { getForecastPositioning, getPositioningForSymbol } from '../positioning';
import { fetchBars, normaliseSymbol, TickerError } from '../ticker/bars';
import { logReturns, realisedVol } from '../ticker/indicators';
import { marketToday } from '../time';
import type { PositioningData } from '../types';
import { buildDrift } from './drift';
import { buildMagnetField } from './magnets';
import { simulate } from './simulate';
import type { ForecastResult } from './types';

export { TickerError };

/** Drawdown counted as a crash. */
const CRASH_THRESHOLD = 0.08;
/** Sessions of real price shown to the left of the cone. */
const HISTORY_DAYS = 90;

/**
 * Positioning for the forecast, if the symbol has any.
 *
 * The configured symbol reuses the cached chain the dashboard already holds,
 * so the default forecast costs nothing extra. Any other ticker gets its own
 * cached lookup, and a symbol with no listed chain simply returns null — that
 * is a normal outcome, not an error.
 */
async function positioningFor(
  symbol: string,
): Promise<{ data: PositioningData | null; note: string | null }> {
  try {
    if (symbol === config.symbol) {
      return { data: await getForecastPositioning(), note: null };
    }
    return { data: await getPositioningForSymbol(symbol), note: null };
  } catch (error) {
    return {
      data: null,
      note:
        error instanceof Error
          ? `No usable listed options for ${symbol} (${error.message})`
          : `No usable listed options for ${symbol}.`,
    };
  }
}

async function build(symbol: string): Promise<ForecastResult> {
  const [positioningResult, series, breadthSnapshot] = await Promise.all([
    positioningFor(symbol),
    fetchBars(symbol, { years: 1 }),
    // Read-only: never triggers a group computation from here.
    peekBreadth(),
  ]);

  const positioning = positioningResult.data;
  const bars = series.bars;
  const closes = bars.map((b) => b.close);

  // Volatility from the last 20 sessions of realised moves.
  const volatility = realisedVol(logReturns(closes).slice(-20));

  const internals = breadthSnapshot?.internals;
  const drift = buildDrift(
    bars,
    internals
      ? {
          score: internals.score,
          universe: internals.universe,
          above50Pct: internals.above50Pct,
          at4wHighPct: internals.at4wHighPct,
          at4wLowPct: internals.at4wLowPct,
        }
      : null,
  );

  const magnets = positioning ? buildMagnetField(positioning) : [];
  // Without a chain there is no dealer spot to anchor to, so the last close is
  // the only honest starting point.
  const spot = positioning?.spot ?? closes[closes.length - 1];
  const horizon = config.forecastHorizon;

  const quoteIso = positioning?.meta.quoteDateIso ?? bars[bars.length - 1].date;

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
    seed: Math.floor(new Date(quoteIso).getTime() / 1000) >>> 0,
  });

  const notes: string[] = [...(positioning?.meta.notes ?? [])];

  if (!positioning) {
    notes.push(
      'Stats-only run: no listed options were found for this symbol, so the cone is shaped by price and volatility alone.',
    );
  } else {
    const furthest = magnets.length > 0 ? magnets[magnets.length - 1].tradingDay : 0;
    if (furthest < horizon) {
      notes.push(
        `Listed expirations reach ${furthest} trading days out; beyond that the paths widen on volatility alone, with no positioning to shape them.`,
      );
    }
    if (result.bendSaturation > 25) {
      notes.push(
        `The magnet pull hit its 0.3-sigma cap on ${result.bendSaturation.toFixed(0)}% of simulated days, so positioning is being held back from dominating the paths.`,
      );
    }
  }

  /*
   * The bar series ends at the last completed session, but the cone starts
   * from the live spot. Pinning the final point closes the visible jump at
   * the join and is the more accurate thing to draw.
   */
  const history = bars.slice(-HISTORY_DAYS).map((b) => ({ date: b.date, close: b.close }));
  const today = marketToday();
  if (history.length > 0 && history[history.length - 1].date === today) {
    history[history.length - 1] = { date: today, close: spot };
  } else {
    history.push({ date: today, close: spot });
  }

  const now = new Date();

  return {
    symbol,
    name: series.name,
    spot,
    hasOptions: positioning !== null,
    optionsNote: positioningResult.note,
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
    regime: positioning?.summary.regime ?? null,
    netGex: positioning?.summary.netGex ?? null,
    gammaFlip: positioning?.summary.flipLevel ?? null,
    asOfLabel: positioning?.meta.asOfLabel ?? new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
    }).format(now),
    quoteDateLabel: positioning?.meta.quoteDateLabel ?? `close ${bars[bars.length - 1].date}`,
    quoteDateIso: positioning?.meta.quoteDateIso ?? null,
    source: positioning?.meta.sourceLabel ?? `${series.source} (prices only)`,
    cacheSeconds: config.forecastCacheSeconds,
    notes,
  };
}

/**
 * Cached forecast, per symbol. Re-simulating is cheap; refetching is not.
 */
export function getForecast(rawSymbol?: string): Promise<ForecastResult> {
  const symbol = rawSymbol ? normaliseSymbol(rawSymbol) : config.symbol;
  if (!symbol) {
    throw new TickerError(
      `"${(rawSymbol ?? '').slice(0, 12)}" is not a valid ticker.`,
      400,
      'Use a US listing such as SPY, AAPL or NVDA.',
    );
  }

  return cached(
    `forecast:${symbol}:${config.forecastHorizon}:${config.forecastPaths}`,
    config.forecastCacheSeconds,
    () => build(symbol),
  );
}
