import 'server-only';

import { fetchTradierQuotes, tradierToken } from '../breadth/tradier';
import { operatorDetail } from '../errorText';
import { marketSessionRules } from '../events';
import { getDigestBySymbol, getRsResult } from '../rs';
import { getMembership } from '../rs/membership';
import { sectorMap, GICS_NAMES, type Gics } from '../rs/universe';
import { DEFAULT_WEIGHTS, type DigestEntry } from '../rs/types';
import { lookupEarnings } from '../scanner/earnings';
import { formatEtClock } from '../scanner/schedule';
import { peekStoredSectors, splitByMomentum } from '../sectors';
import { inSession, lastCompletedSession, sessionFor } from '../staleness';
import { marketNow, marketToday } from '../time';
import {
  byChangeDescending,
  pctFrom,
  qualifies,
  trendFrom,
  warningsFor,
} from './rules';
import { MAX_MOVERS, type MoverRow, type MoversResult } from './types';

/**
 * Build the intraday movers list.
 *
 * ## Two upstream requests, and no third
 *
 * Everything except the live quotes and the earnings dates is read from
 * documents this project already stores, which is the whole reason a
 * fifteen-minute refresh is affordable:
 *
 * 1. **Tradier batch quotes**, one POST for the whole universe — the same
 *    call the breadth sweep makes, extended to carry session volume. That is
 *    where today's price and today's share count come from.
 * 2. **Tradier fundamentals calendar**, one GET, and only for the fifteen
 *    names that actually made the list. Asking for all five hundred would be
 *    eleven requests to answer a question about fifteen rows.
 *
 * Membership, the RS ranking, the moving averages, the twenty-session volume
 * baseline and the sector momentum are all stored reads and cost nothing.
 *
 * ## The universe is not widened, on purpose
 *
 * Relative volume is a ratio against the name's own history, and the only
 * history this project holds is the S&P 500 shards. A wider list would produce
 * rows whose gate had never actually been applied — a movers list where some
 * rows were checked and some were not is worse than a shorter one.
 *
 * ## What relative volume here is, exactly
 *
 * Today's cumulative share volume divided by the twenty-session average of
 * whole days. The numerator is a running total and the denominator is a whole
 * day, so the reading rises through the session and an 11:00 figure is
 * structurally lower than the same name's 15:30 figure.
 *
 * It is left that way rather than scaled by elapsed time. Prorating a full-day
 * average linearly would assume volume arrives evenly, and it does not — the
 * first half hour is several times its linear share — so a linear denominator
 * would roughly triple every reading at the open, on the one part of the day
 * when a movers list most invites chasing. Understating early is the harmless
 * direction: it holds names off the list, it never puts them on it. The
 * session progress is published beside the number so the caveat is visible
 * rather than buried here, and after the close the figure is the honest
 * full-day one.
 */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * How far through the session `now` is, 0-1.
 *
 * 1 outside a session, where the reading is a completed day rather than a
 * partial one — the relative-volume caveat does not apply to a full day.
 */
function sessionProgressAt(now: Date): number {
  const rules = marketSessionRules();
  if (!inSession(now, rules)) return 1;
  const session = sessionFor(marketNow(now).date, rules);
  const span = session.closeMs - session.openMs;
  if (!(span > 0)) return 1;
  return clamp01((now.getTime() - session.openMs) / span);
}

/** An empty reading that still carries the clock and the reason. */
function nothing(
  now: Date,
  live: boolean,
  sessionDate: string,
  universe: number,
  requests: number,
  notes: string[],
): MoversResult {
  return {
    rows: [],
    capturedAt: now.toISOString(),
    capturedEt: formatEtClock(now),
    live,
    sessionDate,
    sessionProgress: sessionProgressAt(now),
    measured: 0,
    universe,
    gainers: 0,
    qualified: 0,
    noVolumeBaseline: 0,
    requests,
    notes,
  };
}

interface Candidate {
  symbol: string;
  last: number;
  prevClose: number;
  changePct: number;
  volume: number;
  avgVolume20: number;
  relativeVolume: number;
}

export async function computeMovers(now: Date = new Date()): Promise<MoversResult> {
  const rules = marketSessionRules();
  const live = inSession(now, rules);
  const sessionDate = live ? marketToday(now) : lastCompletedSession(now, rules).date;
  const notes: string[] = [];

  const membership = await getMembership();
  const symbols = membership.members.map((m) => m.symbol);

  if (!tradierToken()) {
    /*
     * There is no Yahoo fallback here, and that is deliberate rather than an
     * omission. The spark endpoint the breadth sweep falls back to carries a
     * price series and no volume at all, so the one gate this list applies
     * could not be applied — and a movers list with the volume gate silently
     * switched off is precisely the thing this feature must never become.
     */
    return nothing(now, live, sessionDate, symbols.length, 0, [
      'TRADIER_TOKEN is not set, so no quotes could be read. There is no ' +
        'fallback feed carrying share volume, and the relative-volume gate is ' +
        'the only thing separating this list from a list of arbitrary prints, ' +
        'so nothing is shown rather than an ungated list.',
    ]);
  }

  let quotes: Awaited<ReturnType<typeof fetchTradierQuotes>>['quotes'];
  let requests = 1;
  try {
    const result = await fetchTradierQuotes(symbols);
    quotes = result.quotes;
    if (result.unmatched.length > 0) {
      notes.push(
        `${result.unmatched.length} symbols on the membership list were not ` +
          `recognised by the quote feed and are not counted: ${result.unmatched.join(', ')}.`,
      );
    }
  } catch (error) {
    /*
     * The detail goes to the log, not to the page. `fetch()` collapses every
     * connection-level failure into "fetch failed" and puts the real reason in
     * `cause`, so logging `error.message` alone reports nothing a reader or an
     * operator can act on — a refused socket, a DNS miss and a TLS chain that
     * will not verify all arrive looking identical.
     */
    console.warn('[movers] quote feed failed:', operatorDetail(error));

    return nothing(now, live, sessionDate, symbols.length, requests, [
      'The quote feed did not answer, so there is no reading for this ' +
        'refresh. Nothing is shown rather than a list with its one gate ' +
        'unapplied; the next refresh tries again.',
    ]);
  }

  const [digests, rs, sectors] = await Promise.all([
    getDigestBySymbol().catch(() => new Map<string, DigestEntry>()),
    getRsResult(DEFAULT_WEIGHTS).catch(() => null),
    peekStoredSectors().catch(() => null),
  ]);

  const sectorOf = sectorMap(membership.members);
  const rsBySymbol = new Map(rs?.rows.map((r) => [r.symbol, r]) ?? []);

  /*
   * "Leading" is the sectors engine's own accelerating set, not a fresh
   * judgement made here. A movers page inventing its own definition of a
   * leading sector while /sectors used another would put two different answers
   * to one question on the same site.
   */
  const leading: Set<string> | null = sectors
    ? new Set(splitByMomentum(sectors).accelerating.map((s) => s.id))
    : null;
  if (!sectors) {
    notes.push(
      'No sectors snapshot is stored yet, so the leading-sector reading is ' +
        'unknown rather than guessed.',
    );
  }

  const candidates: Candidate[] = [];
  let gainers = 0;
  let noVolumeBaseline = 0;

  for (const quote of quotes.values()) {
    const changePct = ((quote.last - quote.prevClose) / quote.prevClose) * 100;

    // Gainers only in this branch. A losers list is a different page with a
    // different set of warnings on it, deferred for the same reason puts are.
    if (!(changePct > 0)) continue;
    gainers += 1;

    const baseline = digests.get(quote.symbol)?.avgVolume20 ?? null;
    const volume = quote.volume ?? null;

    if (volume === null || baseline === null || !(baseline > 0)) {
      /*
       * Cannot be graded, so it cannot qualify. Counted and reported rather
       * than dropped in silence: an ungradeable name is a gap in this
       * project's data, not a name that failed the gate, and the two must not
       * look the same to a reader wondering why a name they can see moving is
       * not here.
       */
      noVolumeBaseline += 1;
      continue;
    }

    if (!qualifies(changePct, volume, baseline)) continue;

    candidates.push({
      symbol: quote.symbol,
      last: quote.last,
      prevClose: quote.prevClose,
      changePct,
      volume,
      avgVolume20: baseline,
      relativeVolume: volume / baseline,
    });
  }

  candidates.sort(byChangeDescending);
  const qualified = candidates.length;
  const shown = candidates.slice(0, MAX_MOVERS);

  const earnings =
    shown.length > 0
      ? await lookupEarnings(
          shown.map((c) => c.symbol),
          sessionDate,
        )
      : null;
  if (earnings) requests += 1;

  const rows: MoverRow[] = shown.map((c) => {
    const digest = digests.get(c.symbol);
    const ema20 = digest?.ema20 ?? null;
    const ema200 = digest?.ema200 ?? null;

    /*
     * The averages are measured against the LIVE price, not the digest's
     * stored close. The stored close is yesterday's, and a name that gapped up
     * through its 200-day average this morning would otherwise be shown as
     * below it in the same row that said it was up seven percent. The averages
     * themselves are yesterday's, which is what a 200-day average is — one
     * more session moves it by a rounding error.
     */
    const pctFrom200 = pctFrom(c.last, ema200);
    const pctFrom20 = pctFrom(c.last, ema20);
    const trend = trendFrom(c.last, ema200);

    const info = earnings?.bySymbol.get(c.symbol);
    const sector = (sectorOf.get(c.symbol) ?? null) as Gics | null;
    const rsRow = rsBySymbol.get(c.symbol);

    const warnings = warningsFor({
      trend,
      pctFrom20,
      relativeVolume: c.relativeVolume,
      earnings: info,
    });

    return {
      symbol: c.symbol,
      last: c.last,
      prevClose: c.prevClose,
      changePct: c.changePct,
      volume: c.volume,
      avgVolume20: c.avgVolume20,
      relativeVolume: c.relativeVolume,
      trend,
      pctFrom200,
      pctFrom20,
      rsScore: rsRow?.score ?? null,
      rsRank: rsRow?.rank ?? null,
      sector,
      sectorName: sector ? GICS_NAMES[sector] : null,
      sectorLeading: leading === null || !sector ? null : leading.has(sector),
      warnings,
      earningsDate: info?.state === 'known' ? info.dateIso : null,
    };
  });

  if (noVolumeBaseline > 0) {
    notes.push(
      `${noVolumeBaseline} names were up on the day but could not be graded on ` +
        'volume — no stored twenty-session baseline yet, or no session volume ' +
        'in the quote. They are left off rather than admitted ungated.',
    );
  }

  if (earnings) notes.push(`Earnings dates: ${earnings.source}.`);

  if (rs === null) {
    notes.push(
      'The relative-strength ranking could not be read, so that column is ' +
        'blank. It is context, not a gate — no row is on or off this list ' +
        'because of it.',
    );
  }

  return {
    rows,
    capturedAt: now.toISOString(),
    capturedEt: formatEtClock(now),
    live,
    sessionDate,
    sessionProgress: sessionProgressAt(now),
    measured: quotes.size,
    universe: symbols.length,
    gainers,
    qualified,
    noVolumeBaseline,
    requests,
    notes,
  };
}
