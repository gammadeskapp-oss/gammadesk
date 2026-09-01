import 'server-only';

import { fetchTradierQuotes, tradierToken } from '../breadth/tradier';
import { operatorDetail } from '../errorText';
import { marketSessionRules, priorSessionDate } from '../events';
import { getDigestBySymbol, getRsResult } from '../rs';
import { getMembership } from '../rs/membership';
import { sectorMap, GICS_NAMES, type Gics } from '../rs/universe';
import { DEFAULT_WEIGHTS, type DigestEntry } from '../rs/types';
import { lookupEarnings } from '../scanner/earnings';
import { formatEtClock } from '../scanner/schedule';
import { peekStoredSectors, splitByMomentum } from '../sectors';
import {
  inSession,
  lastCompletedSession,
  sessionFor,
  sessionLabel,
} from '../staleness';
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
 * ## The provider names the session, and both figures come from it
 *
 * The session reading asks Polygon for the newest completed session it will
 * actually serve, walking back a day at a time, and then asks for the session
 * before it. The percentage change is those two closes and the volume is the
 * newer one's, so the two numbers a row is gated on always describe the same
 * day and come from the same place.
 *
 * The earlier version read the change out of the RS digest and took the
 * session from the digest's `asOfDate`. That was correct but brittle: the
 * overnight refresh stamps `asOfDate` with the session that just closed, and
 * this provider does not serve a session until the following day, so from
 * about 18:00 ET until publication the page could name a day the provider
 * would refuse and had nothing to show for it. An app that reports an
 * entitlement error through the evening reads as broken, in the window someone
 * is most likely planning the next day in.
 *
 * So a session Polygon has not published yet is not an error. The page falls
 * back to the newest one it does have and says which day that is — older but
 * labelled beats correct-but-blank, and the date is on screen either way.
 *
 * ## What the digest still supplies, and why staleness is tolerable there
 *
 * Only slow-moving context: the twenty-session volume baseline, the two moving
 * averages and the relative-strength rank. None of these is a statement about
 * one particular day, and all of them move by a rounding error over a single
 * session, so a digest a session ahead of or behind the reported day does not
 * make a row wrong. That is why names whose shard has not caught up are no
 * longer excluded — the exclusion existed to stop one session's change being
 * divided by another session's volume, and neither number comes from the
 * digest any more.
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
 * How many sessions back to look for one the provider will serve.
 *
 * Four covers a long weekend plus the publication lag. Beyond that the data is
 * old enough that showing it under any heading would be misleading, and the
 * honest answer is that the feed is not working.
 */
const MAX_SESSIONS_BACK = 4;

/** One session's bars, with the session it belongs to. */
interface SessionBars {
  date: string;
  bars: Map<string, { volume: number; close: number }>;
}

/**
 * The newest completed session the provider will actually serve, plus the one
 * before it for prior closes.
 *
 * Walks back from the last completed session rather than assuming today's is
 * available: this provider publishes a session on the following day, so the
 * most recent close is routinely not there yet. Results are cached across the
 * walk so the prior-session fetch never repeats a request already made.
 */
async function resolveSessions(
  now: Date,
  rules: ReturnType<typeof marketSessionRules>,
): Promise<
  { current: SessionBars; prior: SessionBars; requests: number } | { failure: string }
> {
  const seen = new Map<string, Map<string, { volume: number; close: number }> | null>();
  const reasons: string[] = [];
  let requests = 0;

  /** Fetches a session once; a date asked for twice costs one request. */
  async function load(date: string) {
    if (seen.has(date)) return seen.get(date) ?? null;
    requests += 1;
    const result = await fetchGroupedDaily(date);
    const bars = result.ok ? result.bars : null;
    if (!result.ok) reasons.push(result.reason);
    seen.set(date, bars);
    return bars;
  }

  let date: string | null = lastCompletedSession(now, rules).date;

  for (let i = 0; i < MAX_SESSIONS_BACK && date !== null; i += 1) {
    const bars = await load(date);
    if (bars) {
      const priorDate = priorSessionDate(date);
      if (priorDate === null) {
        return { failure: 'No prior session could be identified for a comparison.' };
      }
      const priorBars = await load(priorDate);
      if (!priorBars) {
        return {
          failure:
            `Market data for ${date} is available but the session before it ` +
            'is not, so no percentage change could be computed.',
        };
      }
      return {
        current: { date, bars },
        prior: { date: priorDate, bars: priorBars },
        requests,
      };
    }
    date = priorSessionDate(date);
  }

  return {
    failure:
      reasons[reasons.length - 1] ??
      'No completed session could be read from the market-data provider.',
  };
}

/**
 * The newest published completed session, priced from Polygon grouped daily
 * bars. The reading production always uses.
 */
async function readSession(
  digests: Map<string, DigestEntry>,
  symbols: string[],
  now: Date,
  rules: ReturnType<typeof marketSessionRules>,
  notes: string[],
): Promise<Reading | ReadFailure> {
  const resolved = await resolveSessions(now, rules);
  if ('failure' in resolved) {
    return { sessionDate: lastCompletedSession(now, rules).date, failure: resolved.failure };
  }

  const { current, prior } = resolved;
  const sessionDate = current.date;

  /*
   * Said out loud whenever the newest closed session is not the one on screen.
   * A reader who knows the market closed a few hours ago and sees an older
   * date has to be told why, or the page looks stale rather than honest.
   */
  const newestClosed = lastCompletedSession(now, rules).date;
  if (sessionDate !== newestClosed) {
    notes.push(
      `The ${sessionLabel(newestClosed)} session has closed but the ` +
        'market-data provider has not published it yet, so this reading is ' +
        `${sessionLabel(sessionDate)}. It moves on once that day is available.`,
    );
  }

  const candidates: Candidate[] = [];
  let measured = 0;
  let gainers = 0;
  let noVolumeBaseline = 0;

  for (const symbol of symbols) {
    const today = current.bars.get(symbol);
    const yesterday = prior.bars.get(symbol);
    // Both closes or there is no change to report. A name that did not trade
    // in either session is simply absent rather than counted as flat.
    if (!today || !yesterday) continue;

    measured += 1;

    const changePct = (today.close / yesterday.close - 1) * 100;

    // Gainers only in this branch. A losers list is a different page with a
    // different set of warnings on it, deferred for the same reason puts are.
    if (!(changePct > 0)) continue;
    gainers += 1;

    /*
     * The baseline is the digest's, and it is allowed to be a session out of
     * step with the reported day — see the note on the module. What it may not
     * be is absent, because then the one gate cannot be applied.
     */
    const baseline = digests.get(symbol)?.avgVolume20 ?? null;

    if (baseline === null || !(baseline > 0)) {
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

    if (!qualifies(changePct, today.volume, baseline)) continue;

    candidates.push({
      symbol,
      last: today.close,
      prevClose: yesterday.close,
      changePct,
      volume: today.volume,
      avgVolume20: baseline,
      relativeVolume: today.volume / baseline,
    });
  }

  return {
    sessionDate,
    candidates,
    measured,
    gainers,
    noVolumeBaseline,
    // Reported rather than assumed: the walk may have spent a probe on a
    // session the provider has not published before landing on one it has.
    requests: resolved.requests,
  };
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
    : await readSession(digests, symbols, now, rules, notes);

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
      `${noVolumeBaseline} names were up but could not be graded on volume — ` +
        'no stored twenty-session baseline for them yet. They are left off ' +
        'rather than admitted ungated.',
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
