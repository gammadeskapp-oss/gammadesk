import 'server-only';

import { ChainError } from '../chainSource';
import { fetchCboeRaw, parseOccSymbol, type CboeContract } from '../cboe';
import { config } from '../config';
import { delta as bsDelta, MIN_T } from '../blackScholes';
import { pickContract, toQuality } from './optionQuality';
import {
  OPTION_WINDOW,
  type EarningsInfo,
  type OptionContract,
  type OptionQuality,
  type OptionQualitySource,
} from './types';

/**
 * Reading one name's chain for the option-quality gate.
 *
 * ## One chain, one request
 *
 * This is the quota-sensitive half of the scanner. Cboe answers roughly sixty
 * chains per window and the 08:30 gamma refresh has already spent most of
 * them, so the scan grades only the top ten ranked names and leaves the rest
 * to be graded when a reader clicks. See `OPTION_QUALITY_TOP_N`.
 *
 * ## Delta is modelled, not quoted
 *
 * Cboe publishes gamma but not delta on this feed, so delta is computed
 * Black-Scholes from the quoted implied vol, the same construction the
 * exposure tables use. A contract with no usable vol gets `delta: null` and
 * therefore never enters the 0.55-0.70 window — it is not guessed at, and a
 * name whose whole chain lacks vol grades `unknown` rather than being handed a
 * badge built from an assumption.
 */

/** Calls only. Puts are deliberately out of scope in this branch. */
const TYPE = 'call';

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Calendar days from `now` to a `YYYY-MM-DD` expiry, at UTC midnight both ends. */
function dteOf(expiration: string, now: Date): number {
  const expiry = Date.parse(`${expiration}T00:00:00Z`);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((expiry - today) / 86_400_000);
}

/**
 * Turn one raw Cboe contract into the shape the gate grades.
 *
 * Everything that cannot be read is `null` rather than zero. A zero spread is
 * a claim about the market; a null spread is the absence of one, and
 * `gradeContract` refuses to issue a badge over the second.
 */
function toContract(
  raw: CboeContract,
  spot: number,
  now: Date,
): OptionContract | null {
  if (!raw.option) return null;
  const parsed = parseOccSymbol(raw.option);
  if (!parsed || parsed.type !== TYPE) return null;

  const dte = dteOf(parsed.expiration, now);
  if (!Number.isFinite(dte)) return null;

  const bid = num(raw.bid);
  const ask = num(raw.ask);

  // A crossed or zero-width book is not a tight spread, it is an unusable
  // quote — most often one side simply absent. Left null on purpose.
  const mid = bid !== null && ask !== null && ask > bid && bid > 0 ? (bid + ask) / 2 : null;
  const spreadPctOfMid =
    mid !== null && bid !== null && ask !== null ? ((ask - bid) / mid) * 100 : null;

  const ivRaw = num(raw.iv);
  const iv = ivRaw !== null && ivRaw > 0 ? ivRaw : null;

  const T = Math.max(MIN_T, dte / 365);
  const modelled =
    iv === null
      ? null
      : bsDelta(
          {
            S: spot,
            K: parsed.strike,
            T,
            sigma: iv,
            r: config.riskFreeRate,
            q: config.dividendYield,
          },
          'call',
        );

  const oi = num(raw.open_interest);

  return {
    expiration: parsed.expiration,
    strike: parsed.strike,
    dte,
    delta: modelled !== null && Number.isFinite(modelled) ? modelled : null,
    openInterest: oi === null ? null : Math.max(0, Math.round(oi)),
    volume: num(raw.volume),
    bid,
    ask,
    mid,
    spreadPctOfMid,
    ivPct: iv === null ? null : iv * 100,
  };
}

/**
 * Grade one symbol's call chain.
 *
 * Never throws. A chain that cannot be read produces an `unknown` badge with
 * the reason attached, because the alternative — letting the error escape —
 * would take down a scan over a single unreachable name, and because the page
 * has to be able to say "we could not check this" as a first-class outcome.
 */
export async function gradeSymbol(
  symbol: string,
  earnings: EarningsInfo,
  source: OptionQualitySource,
): Promise<OptionQuality> {
  const checkedAt = new Date().toISOString();

  let raw;
  try {
    raw = await fetchCboeRaw(symbol);
  } catch (error) {
    const reason =
      error instanceof ChainError
        ? `The ${symbol} option chain could not be read (${error.message}).`
        : `The ${symbol} option chain could not be read.`;
    return toQuality(
      {
        contract: null,
        earningsDaysAway: earnings.daysAway,
        earningsUnknown: earnings.state === 'unknown',
        unreadable: reason,
      },
      { source, checkedAt, quoteDateIso: null },
    );
  }

  const now = new Date();
  const candidates: OptionContract[] = [];

  for (const contract of raw.contracts) {
    /*
     * Filtered on DTE before anything is modelled. A full chain is several
     * thousand contracts and the Black-Scholes delta is the expensive part;
     * the window is a few dozen.
     */
    if (!contract.option) continue;
    const parsed = parseOccSymbol(contract.option);
    if (!parsed || parsed.type !== TYPE) continue;

    const dte = dteOf(parsed.expiration, now);
    if (dte < OPTION_WINDOW.minDte || dte > OPTION_WINDOW.maxDte) continue;

    const mapped = toContract(contract, raw.spot, now);
    if (mapped) candidates.push(mapped);
  }

  return toQuality(
    {
      contract: pickContract(candidates),
      earningsDaysAway: earnings.daysAway,
      earningsUnknown: earnings.state === 'unknown',
    },
    { source, checkedAt, quoteDateIso: raw.quoteDate.toISOString() },
  );
}
