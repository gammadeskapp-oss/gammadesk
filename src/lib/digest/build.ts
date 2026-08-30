import { regimeLabel } from '../regime';
import 'server-only';

import { getForecast } from '../forecast';
import { riskLabel } from '../forecast/risk';
import { getGroupsSnapshot } from '../groups';
import { rankTickers } from '../groups/ranking';
import { getPositioning } from '../positioning';
import { formatPrice } from '../format';
import { marketNow, MARKET_TZ } from '../time';
import type { Digest, DigestRank } from './types';

/**
 * Composes the daily digest from data that is already cached.
 *
 * Every source here — positioning, forecast, group snapshot — is behind its
 * own cache, so building a digest costs no upstream requests of its own.
 */

function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MARKET_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function usdCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

export async function buildDigest(): Promise<Digest> {
  const now = marketNow();

  const [positioning, forecast, groups] = await Promise.all([
    getPositioning(),
    getForecast().catch(() => null),
    getGroupsSnapshot().catch(() => null),
  ]);

  const ranked = groups ? rankTickers(groups) : [];
  const leaders: DigestRank[] = ranked
    .slice(0, 3)
    .map((r) => ({ symbol: r.symbol, score: r.score }));
  const laggards: DigestRank[] = ranked
    .slice(-3)
    .reverse()
    .map((r) => ({ symbol: r.symbol, score: r.score }));

  const spot = positioning.spot;
  const regime = positioning.summary.regime;
  const flip = positioning.summary.flipLevel;

  const odds3d = forecast?.odds.find((o) => o.day === 3)?.higherPct ?? null;
  const odds10d = forecast?.odds.find((o) => o.day === 10)?.higherPct ?? null;
  const crashPct = forecast?.crashPct ?? null;
  const risk = crashPct === null ? null : riskLabel(crashPct);

  // --- the readable part ----------------------------------------------------
  const lines: string[] = [];

  lines.push(
    `${positioning.symbol} is at ${formatPrice(spot)} with dealers in ` +
      `${regimeLabel(regime)} — their hedging ${
        regime === 'positive'
          ? 'leans against moves, which tends to mean chop and mean reversion'
          : 'leans with moves, which tends to mean faster, trendier action'
      }.`,
  );

  if (flip !== null) {
    // Measured from spot, because the sentence describes where the FLIP sits
    // relative to price — not the other way round.
    const distance = ((flip - spot) / spot) * 100;
    const side = distance >= 0 ? 'above' : 'below';
    lines.push(
      `The gamma flip sits at ${formatPrice(flip)}, ` +
        `${Math.abs(distance).toFixed(2)}% ${side} spot. ` +
        `Crossing it is where that behaviour switches.`,
    );
  } else {
    lines.push(
      'No gamma flip level was found within ±15% of spot, so there is no ' +
        'nearby level where dealer behaviour flips.',
    );
  }

  if (odds3d !== null && odds10d !== null) {
    const lean =
      odds10d >= 55 ? 'leans higher' : odds10d <= 45 ? 'leans lower' : 'is close to a coin flip';
    lines.push(
      `The simulation ${lean}: ${odds3d.toFixed(0)}% of paths close higher in ` +
        `3 days and ${odds10d.toFixed(0)}% in 10 days.`,
    );
  }

  if (crashPct !== null && risk !== null) {
    lines.push(
      `Downturn risk reads ${risk} — ${crashPct.toFixed(1)}% of paths trade 8% ` +
        `or more below spot at some point in the next 20 sessions.`,
    );
  }

  if (leaders.length > 0 && laggards.length > 0) {
    lines.push(
      `Strongest of the tracked names: ${leaders
        .map((l) => `${l.symbol} (${l.score})`)
        .join(', ')}. Weakest: ${laggards
        .map((l) => `${l.symbol} (${l.score})`)
        .join(', ')}.`,
    );
  }

  const notes: string[] = [];
  if (!forecast) notes.push('Forecast unavailable, so the odds are omitted.');
  if (ranked.length === 0) {
    notes.push('No group snapshot stored yet, so leaders and laggards are omitted.');
  }

  return {
    date: now.date,
    dateLabel: dateLabel(now.date),
    generatedAt: new Date().toISOString(),
    symbol: positioning.symbol,
    spot,
    regime,
    flipLevel: flip,
    netGex: positioning.summary.netGex,
    odds3d,
    odds10d,
    crashPct,
    riskLabel: risk,
    leaders,
    laggards,
    lines,
    notes,
  };
}

/**
 * Discord message body.
 *
 * Kept as plain markdown rather than an embed: it renders identically on
 * mobile, degrades gracefully, and there is nothing here that needs a card.
 * Discord caps `content` at 2000 characters; this lands well under 700.
 */
export function toDiscordMessage(digest: Digest): string {
  const parts: string[] = [];

  parts.push(`**GammaDesk — ${digest.dateLabel}**`);

  const flip =
    digest.flipLevel === null ? 'flip n/a' : `flip ${formatPrice(digest.flipLevel)}`;
  parts.push(
    `${digest.symbol} ${formatPrice(digest.spot)} · gamma **${regimeLabel(digest.regime)}** ` +
      `(${usdCompact(digest.netGex)}) · ${flip}`,
  );

  if (digest.odds3d !== null && digest.odds10d !== null) {
    const risk =
      digest.riskLabel && digest.crashPct !== null
        ? ` · downturn **${digest.riskLabel}** (${digest.crashPct.toFixed(1)}%)`
        : '';
    parts.push(
      `Forecast: **${digest.odds3d.toFixed(0)}%** higher in 3d, ` +
        `**${digest.odds10d.toFixed(0)}%** in 10d${risk}`,
    );
  }

  if (digest.leaders.length > 0) {
    parts.push(
      `Leaders: ${digest.leaders.map((l) => `${l.symbol} ${l.score}`).join(' · ')}`,
    );
  }
  if (digest.laggards.length > 0) {
    parts.push(
      `Laggards: ${digest.laggards.map((l) => `${l.symbol} ${l.score}`).join(' · ')}`,
    );
  }

  for (const note of digest.notes) parts.push(`⚠ ${note}`);

  parts.push(
    '_Modelled from backward-looking signals. Informational and educational ' +
      'purposes only, not investment advice._',
  );

  return parts.join('\n');
}
