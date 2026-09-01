import 'server-only';

import { marketSessionRules } from '../events';
import { getDigestBySymbol, getRsResult } from '../rs';
import { getMembership } from '../rs/membership';
import { sectorMap, GICS_NAMES, type Gics } from '../rs/universe';
import { DEFAULT_WEIGHTS, type DigestEntry } from '../rs/types';
import { lookupEarnings } from '../scanner/earnings';
import { formatEtClock } from '../scanner/schedule';
import { peekStoredSectors, splitByMomentum } from '../sectors';
import { lastCompletedSession } from '../staleness';
import { fetchGroupedDaily } from './groupedDaily';
import {
  byChangeDescending,
  pctFrom,
  qualifies,
  trendFrom,
  warningsFor,
} from './rules';
import { MAX_MOVERS, type MoverRow, type MoversResult } from './types';

/**
 * Build the last-completed-session movers list.
 *
 * ## Why a finished session rather than a live one
 *
 * This reports the session that has closed, not the one in progress, and that
 * is a deliberate choice about what the app is for rather than a fallback.
 *
 * A live intraday list of what is running right now is a day-trading
 * instrument: it invites acting on a move while it is happening, and its
 * relative-volume figure is a running total against a whole-day average, so
 * the number is structurally understated all morning and only becomes exact
 * at the close. The rest of this project is built for swing decisions made on
 * daily bars. A finished session fits that: every figure on the page is final,
 * the volume ratio is a whole day over an average of whole days, and nothing
 * on it can change while it is being read.
 *
 * The page is named for what it shows. It is not "moving today".
 *
 * ## One upstream request
 *
 * 1. **Polygon grouped daily bars**, one GET for the whole US market, read for
 *    the session's share volume. See `groupedDaily.ts` — that endpoint is the
 *    one figure this project does not already store.
 *
 * Everything else is a stored read and costs nothing: membership, the RS
 * ranking, the moving averages, the twenty-session volume baseline, the
 * session's percentage change and the sector momentum all come out of the RS
 * digest and the sectors snapshot.
 *
 * The earnings warning is a second request, and only for the handful of names
 * that made the list. It has no non-Tradier source, so in production it
 * resolves to "unknown" for every row and the row says so — see
 * `scanner/earnings.ts`.
 *
 * ## The digest sets the session, and everything is checked against it
 *
 * `sessionDate` is the digest's own `asOfDate`, not a date computed from the
 * clock. The percentage change comes from the digest and the volume comes from
 * Polygon, so the two have to describe the same day or the ratio is a
 * comparison between two different sessions wearing one date. Asking the
 * provider for exactly the digest's session, and refusing when the digest
 * cannot name one, is what keeps that from happening quietly.
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
 * The session's total share volume divided by the twenty-session average of
 * whole days. Both sides are complete days, so the figure is exact rather than
 * a running total that has to be read with the clock in mind. That caveat, and
 * the session-progress number that used to carry it, are gone with the live
 * reading that needed them.
 */

/** An empty reading that still carries the clock and the reason. */
function nothing(
  now: Date,
  sessionDate: string,
  universe: number,
  requests: number,
  notes: string[],
): MoversResult {
  return {
    rows: [],
    capturedAt: now.toISOString(),
    capturedEt: formatEtClock(now),
    sessionDate,
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
  const notes: string[] = [];

  const membership = await getMembership();
  const symbols = membership.members.map((m) => m.symbol);

  const [digests, rs, sectors] = await Promise.all([
    getDigestBySymbol().catch(() => new Map<string, DigestEntry>()),
    getRsResult(DEFAULT_WEIGHTS).catch(() => null),
    peekStoredSectors().catch(() => null),
  ]);

  /*
   * The digest names the session, because the digest is what the percentage
   * change is read from. Falling back to a date derived from the clock would
   * let the page ask the provider for a day the stored side knows nothing
   * about, and then divide one session's volume by another session's average.
   */
  const digestDates = new Set<string>();
  for (const entry of digests.values()) digestDates.add(entry.asOfDate);
  const storedSession = [...digestDates].sort().pop() ?? null;

  if (storedSession === null) {
    return nothing(now, lastCompletedSession(now, rules).date, symbols.length, 0, [
      'No stored price history is available yet, so no session can be ' +
        'reported. The relative-strength refresh fills this overnight, a ' +
        'quarter of the index at a time.',
    ]);
  }

  const sessionDate = storedSession;

  /*
   * Shards rotate one at a time, so a shard that has not run since the last
   * close still carries the session before it. Those names are counted out
   * rather than mixed in: a row whose change came from Monday and whose volume
   * came from Tuesday would look like an ordinary row.
   */
  const staleDigests = [...digestDates].filter((d) => d !== sessionDate);
  if (staleDigests.length > 0) {
    notes.push(
      `Some stored history is still one session behind (${staleDigests
        .sort()
        .join(', ')}), and those names are left out of this reading rather ` +
        'than mixed into it. The overnight refresh brings them up.',
    );
  }

  const grouped = await fetchGroupedDaily(sessionDate);
  let requests = 1;

  if (!grouped.ok) {
    return nothing(now, sessionDate, symbols.length, requests, [
      `${grouped.reason} Nothing is shown rather than a list with its one ` +
        'gate unapplied.',
    ]);
  }

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
    sessionDate,
    measured,
    universe: symbols.length,
    gainers,
    qualified,
    noVolumeBaseline,
    requests,
    notes,
  };
}
