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
import { fetchGroupedDaily } from './groupedDaily';
import {
  byChangeDescending,
  pctFrom,
  qualifies,
  trendFrom,
  warningsFor,
} from './rules';
import {
  MAX_MOVERS,
  type MoverRow,
  type MoversResult,
  type MoversSource,
} from './types';

/**
 * Build the movers list, from whichever source this deployment is allowed.
 *
 * ## Two readings, and the boundary between them is a rule
 *
 * - **`session`** - Polygon grouped daily bars for the last completed session.
 *   One request, no entitlement beyond the key already here. This is what the
 *   public site shows, always.
 * - **`live`** - Tradier batch quotes for the day in progress. Runs only when
 *   `TRADIER_TOKEN` is present, which is only ever a developer's machine.
 *
 * Tradier's data may not be redistributed, and putting it on a page visitors
 * can load is redistribution whether or not anyone is charged for it. So the
 * production deploy carries no token, and the selection below is written so no
 * code path *depends* on one existing: absence is the ordinary case and takes
 * the session branch without complaint. There is deliberately no
 * password-protected variant - an unlisted page is not a private one, and a
 * protected public deploy still puts the data on a URL a third party can
 * reach.
 *
 * ## What the two share, which is nearly everything
 *
 * The gate, the context columns and the warnings are identical. Both readings
 * produce the same `Candidate` list and then run through one row-building
 * pass, so there is no second copy of the rules that could drift from the
 * first. Only the price source and the labelling differ.
 *
 * The ungradeable case is the same in both: a name with no stored
 * twenty-session baseline is held back and counted, never shown with its one
 * gate unapplied.
 *
 * ## Why the session reading is the better feature anyway
 *
 * A live list of what is running right now invites acting mid-move, which is
 * day trading; the rest of this project is built for swing decisions on daily
 * bars. On the session reading every figure is final and the volume ratio is a
 * whole day over an average of whole days, so it needs no allowance made for
 * the time of day it was read. The live reading is kept because it is useful
 * while developing against a real intraday tape, not because it is the version
 * that should ship.
 *
 * ## The digest names the session, on the session reading
 *
 * `sessionDate` there is the digest's own `asOfDate`, and Polygon is asked for
 * exactly that day. Reading the change from stored history and the volume from
 * a date derived off the clock would eventually divide one session's volume by
 * another session's average and render it as an ordinary row.
 *
 * ## The universe is not widened, on purpose
 *
 * Relative volume is a ratio against the name's own history, and the only
 * history this project holds is the S&P 500 shards. A wider list would produce
 * rows whose gate had never actually been applied - a movers list where some
 * rows were checked and some were not is worse than a shorter one.
 */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * How far through the session `now` is, 0-1.
 *
 * Only the live reading has a partial day to describe. 1 outside a session,
 * and 1 for the session reading, where both sides of the volume ratio are
 * complete days and the caveat does not apply.
 */
function sessionProgressAt(now: Date): number {
  const rules = marketSessionRules();
  if (!inSession(now, rules)) return 1;
  const session = sessionFor(marketNow(now).date, rules);
  const span = session.closeMs - session.openMs;
  if (!(span > 0)) return 1;
  return clamp01((now.getTime() - session.openMs) / span);
}

/** An empty reading that still carries the clock, the source and the reason. */
function nothing(
  now: Date,
  source: MoversSource,
  sessionDate: string,
  universe: number,
  requests: number,
  notes: string[],
): MoversResult {
  return {
    rows: [],
    capturedAt: now.toISOString(),
    capturedEt: formatEtClock(now),
    source,
    live: source === 'live',
    sessionDate,
    sessionProgress: source === 'live' ? sessionProgressAt(now) : 1,
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


/**
 * What a source produces before the shared row-building pass.
 *
 * Both readings return this and nothing else, which is what keeps the gate and
 * the warnings from being implemented twice.
 */
interface Reading {
  sessionDate: string;
  candidates: Candidate[];
  measured: number;
  gainers: number;
  noVolumeBaseline: number;
  requests: number;
}

/** Returned instead of a `Reading` when a source cannot produce one. */
interface ReadFailure {
  failure: string;
  sessionDate: string | null;
}

/**
 * The last completed session, priced from Polygon grouped daily bars.
 *
 * The reading production always uses.
 */
async function readSession(
  digests: Map<string, DigestEntry>,
  symbols: string[],
  notes: string[],
): Promise<Reading | ReadFailure> {
  /*
   * The digest names the session, because the digest is what the percentage
   * change is read from. Falling back to a date derived from the clock would
   * let the page ask the provider for a day the stored side knows nothing
   * about, and then divide one session's volume by another session's average.
   */
  const digestDates = new Set<string>();
  for (const entry of digests.values()) digestDates.add(entry.asOfDate);
  const sessionDate = [...digestDates].sort().pop() ?? null;

  if (sessionDate === null) {
    return {
      sessionDate: null,
      failure:
        'No stored price history is available yet, so no session can be ' +
        'reported. The relative-strength refresh fills this overnight, a ' +
        'quarter of the index at a time.',
    };
  }

  /*
   * Shards rotate one at a time, so a shard that has not run since the last
   * close still carries the session before it. Those names are counted out
   * rather than mixed in: a row whose change came from Monday and whose volume
   * came from Tuesday would look like an ordinary row.
   */
  const stale = [...digestDates].filter((d) => d !== sessionDate);
  if (stale.length > 0) {
    notes.push(
      `Some stored history is still one session behind (${stale
        .sort()
        .join(', ')}), and those names are left out of this reading rather ` +
        'than mixed into it. The overnight refresh brings them up.',
    );
  }

  const grouped = await fetchGroupedDaily(sessionDate);
  if (!grouped.ok) return { sessionDate, failure: grouped.reason };

  const candidates: Candidate[] = [];
  let measured = 0;
  let gainers = 0;
  let noVolumeBaseline = 0;

  for (const symbol of symbols) {
    const digest = digests.get(symbol);
    // No stored history, or history that stops before the session being
    // reported. Either way there is no percentage change for this day.
    if (!digest || digest.asOfDate !== sessionDate) continue;
    if (digest.changePct === null) continue;

    measured += 1;

    // The digest holds the change as a fraction; every figure downstream of
    // here is a percentage.
    const changePct = digest.changePct * 100;

    // Gainers only in this branch. A losers list is a different page with a
    // different set of warnings on it, deferred for the same reason puts are.
    if (!(changePct > 0)) continue;
    gainers += 1;

    const baseline = digest.avgVolume20 ?? null;
    const volume = grouped.bars.get(symbol)?.volume ?? null;

    if (volume === null || baseline === null || !(baseline > 0)) {
      /*
       * Cannot be graded, so it cannot qualify. Counted and reported rather
       * than dropped in silence: an ungradeable name is a gap in this
       * project's data, not a name that failed the gate, and the two must not
       * look the same to a reader wondering why a name they can see moved is
       * not here.
       */
      noVolumeBaseline += 1;
      continue;
    }

    if (!qualifies(changePct, volume, baseline)) continue;

    const last = digest.close;
    candidates.push({
      symbol,
      last,
      // Recovered from the close and the session's own change, so it is the
      // same two numbers the percentage came from rather than a third source.
      prevClose: last / (1 + digest.changePct),
      changePct,
      volume,
      avgVolume20: baseline,
      relativeVolume: volume / baseline,
    });
  }

  return { sessionDate, candidates, measured, gainers, noVolumeBaseline, requests: 1 };
}

/**
 * The session in progress, priced from Tradier batch quotes. Local only.
 *
 * Reached only when `TRADIER_TOKEN` is set, which production never does. See
 * the note on `MoversSource` for why that is a rule and not a preference.
 */
async function readLive(
  digests: Map<string, DigestEntry>,
  symbols: string[],
  sessionDate: string,
  notes: string[],
): Promise<Reading | ReadFailure> {
  let quotes: Awaited<ReturnType<typeof fetchTradierQuotes>>['quotes'];
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
     * `cause`, so logging `error.message` alone reports nothing an operator
     * can act on.
     */
    console.warn('[movers] quote feed failed:', operatorDetail(error));
    return {
      sessionDate,
      failure: 'The quote feed did not answer, so there is no reading for this refresh.',
    };
  }

  const candidates: Candidate[] = [];
  let gainers = 0;
  let noVolumeBaseline = 0;

  for (const quote of quotes.values()) {
    const changePct = ((quote.last - quote.prevClose) / quote.prevClose) * 100;
    if (!(changePct > 0)) continue;
    gainers += 1;

    const baseline = digests.get(quote.symbol)?.avgVolume20 ?? null;
    const volume = quote.volume ?? null;

    // Identical to the session reading: ungradeable is held back and counted,
    // never shown with the gate unapplied.
    if (volume === null || baseline === null || !(baseline > 0)) {
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

  return {
    sessionDate,
    candidates,
    measured: quotes.size,
    gainers,
    noVolumeBaseline,
    requests: 1,
  };
}

export async function computeMovers(now: Date = new Date()): Promise<MoversResult> {
  const rules = marketSessionRules();
  const notes: string[] = [];

  /*
   * Absence of a token is the ordinary case, not a degraded one: it is what
   * production looks like. Nothing below may assume the credential exists.
   */
  const source: MoversSource = tradierToken() ? 'live' : 'session';
  const live = source === 'live';

  const membership = await getMembership();
  const symbols = membership.members.map((m) => m.symbol);

  const [digests, rs, sectors] = await Promise.all([
    getDigestBySymbol().catch(() => new Map<string, DigestEntry>()),
    getRsResult(DEFAULT_WEIGHTS).catch(() => null),
    peekStoredSectors().catch(() => null),
  ]);

  const clockSession = live ? marketToday(now) : lastCompletedSession(now, rules).date;

  const reading = live
    ? await readLive(digests, symbols, clockSession, notes)
    : await readSession(digests, symbols, notes);

  if ('failure' in reading) {
    return nothing(now, source, reading.sessionDate ?? clockSession, symbols.length, 1, [
      `${reading.failure} Nothing is shown rather than a list with its one gate unapplied.`,
    ]);
  }

  const { sessionDate, candidates, measured, gainers, noVolumeBaseline } = reading;
  let requests = reading.requests;

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
     * Price and averages are all the reported session's own, out of the same
     * digest entry, so a row cannot say a name closed up seven percent and
     * place it against an average from a different day. When the reading was
     * live this had to reach for the intraday price instead, and the mismatch
     * that created is one more thing a finished session removes.
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
    source,
    live,
    sessionDate,
    sessionProgress: live ? sessionProgressAt(now) : 1,
    measured,
    universe: symbols.length,
    gainers,
    qualified,
    noVolumeBaseline,
    requests,
    notes,
  };
}
