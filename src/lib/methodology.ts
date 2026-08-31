import { dealerConventionCaveat } from './dealerConvention';
import { MIN_OI, MIN_RATIO, MIN_VOLUME } from './flow/types';
import type { DataMeta, IvSource, PositioningData } from './types';

/**
 * What went into a number, stated as fact rather than as reassurance.
 *
 * ## Why this is a module and not markup
 *
 * The methodology drawers appear under level blocks on three pages, and the
 * same facts are collected again on /methodology. Written inline they would be
 * four hand-maintained copies of the same claims, and the copies would go out
 * of step quietly — a drawer that says "five expirations" under a table built
 * from twenty is a worse lie than no drawer, because it was read as an answer.
 *
 * Everything here is derived from the snapshot that produced the numbers on
 * screen, or from an exported constant the engine actually applies. Nothing is
 * retyped from memory.
 *
 * Pure and dependency-light so it can be called from a server page or a client
 * component without either needing to know which.
 */

/** What a level is actually measured from. */
export type LevelBasis = 'gamma-exposure' | 'open-interest' | 'volume';

const BASIS_WORDS: Record<LevelBasis, string> = {
  'gamma-exposure':
    'Gamma exposure — open interest weighted by each contract’s gamma, not the raw contract count.',
  'open-interest': 'Open interest — the raw count of contracts held at each strike.',
  volume: 'Volume — contracts traded during the session, not positions held.',
};

export interface Fact {
  label: string;
  value: string;
  /** One line of qualification, where the value alone would mislead. */
  note?: string;
}

export interface Methodology {
  /** Heading for the drawer, e.g. "How this is calculated". */
  title: string;
  facts: Fact[];
  /** The assumption everything rests on, in full. */
  assumption: string;
  /** Extra caveat for this specific underlying, or null. */
  caveat: string | null;
  /** Notes the snapshot itself attached. */
  notes: string[];
}

/** `quoted / solved / modelled`, with the share that was modelled. */
function ivSummary(ivSources: Record<IvSource, number>): { value: string; note?: string } {
  const total = ivSources.quoted + ivSources.solved + ivSources.model;
  if (total === 0) return { value: 'no strikes resolved' };

  const modelledPct = Math.round((ivSources.model / total) * 100);
  const value =
    `${ivSources.quoted} quoted, ${ivSources.solved} solved from price, ` +
    `${ivSources.model} modelled`;

  return {
    value,
    note:
      modelledPct >= 25
        ? `${modelledPct}% had no usable quoted volatility and fall back to a modelled surface, so treat the exposure sizes as approximate.`
        : 'Resolution order per strike: quoted out-of-the-money volatility, then quoted in-the-money, then solved from the mid price, then a modelled surface.',
  };
}

/**
 * The dealer-positioning assumption, spelled out.
 *
 * Every level on the site inherits this. It is stated in full rather than
 * summarised, because "we assume dealers are long calls and short puts" is the
 * single sentence that decides whether the reader should believe any of the
 * rest — and it is an assumption, not a measurement.
 */
export const DEALER_ASSUMPTION =
  'Dealer positioning is assumed, not observed. The model takes the customer ' +
  'to be a buyer of puts and a seller of calls, which puts the dealer long ' +
  'calls and short puts. Nothing in an option chain records who was on which ' +
  'side of a trade, so this is a convention that fits index and large-cap ' +
  'books and can be exactly backwards on a heavily retail-traded single name.';

/**
 * The facts behind a positioning level block.
 *
 * Takes the snapshot the page is rendering, so the values describe that
 * render and not a general case.
 */
export function positioningMethodology(
  data: Pick<PositioningData, 'symbol' | 'spot' | 'expirations' | 'expirationMeta'> & {
    meta: DataMeta;
  },
  basis: LevelBasis = 'gamma-exposure',
): Methodology {
  const { meta } = data;
  const iv = ivSummary(meta.ivSources);

  const expirationList =
    data.expirationMeta.length > 0
      ? data.expirationMeta.map((e) => `${e.date} (${e.dte}d)`).join(', ')
      : 'none resolved';

  return {
    title: 'How this is calculated',
    facts: [
      {
        label: 'Underlying price used',
        value: `${data.symbol} ${data.spot.toFixed(2)}`,
        note: 'Taken from the same chain snapshot as the levels, so price and levels always describe one moment.',
      },
      {
        label: 'Snapshot timestamp',
        value: meta.quoteDateLabel,
        note: `The feed's own stamp, not the time this page rendered (${meta.asOfLabel}). Quotes are delayed.`,
      },
      {
        label: 'Expirations included',
        value: `${data.expirations.length} — ${expirationList}`,
      },
      {
        label: 'Calls and puts',
        value: 'Both, at every strike in the window',
        note: `Strikes are limited to the nearest bands either side of spot; ${meta.contractsUsed.toLocaleString('en-US')} contracts went into this view.`,
      },
      {
        label: 'Open interest as of',
        value: 'The prior session’s settlement',
        note: 'Open interest is published after the close and does not move intraday. Today’s trading is not in it yet, so a level built from open interest describes positions held into today, not positions opened during it.',
      },
      {
        label: 'Implied volatility source',
        value: iv.value,
        note: iv.note,
      },
      {
        label: 'This level is derived from',
        value: BASIS_WORDS[basis],
      },
      {
        label: 'Data source',
        value: meta.sourceLabel,
        note: `Rate r ${(meta.riskFreeRate * 100).toFixed(1)}%, dividend yield q ${(meta.dividendYield * 100).toFixed(1)}%, used for the greeks.`,
      },
    ],
    assumption: DEALER_ASSUMPTION,
    caveat: dealerConventionCaveat(data.symbol),
    notes: meta.notes,
  };
}

/**
 * The facts behind the /flow screen.
 *
 * Same shape as the positioning drawer on purpose: a reader who has opened one
 * should not have to learn a second layout to read the other.
 */
export function flowMethodology(computedAtLabel: string | null): Methodology {
  return {
    title: 'How this is calculated',
    facts: [
      {
        label: 'The rule',
        value: 'Session volume divided by open interest, per contract',
        note: `A contract is listed when it trades at least ${MIN_VOLUME.toLocaleString('en-US')} contracts, carries at least ${MIN_OI} open interest, and its ratio is at least ${MIN_RATIO.toFixed(1)}×.`,
      },
      {
        label: 'Why that ratio means anything',
        value: 'Open interest is yesterday’s settled position count',
        note: 'So a contract trading more than its own open interest in one session means most of today’s activity is opening new exposure rather than shuffling existing positions.',
      },
      {
        label: 'Open interest as of',
        value: 'The prior session’s settlement',
        note: 'It is published after the close and does not move intraday, which is precisely what makes it a usable denominator for today’s volume.',
      },
      {
        label: 'Volume as of',
        value: computedAtLabel ?? 'not yet computed',
        note: 'Today’s traded contracts, from the same snapshot as the open interest.',
      },
      {
        label: 'This level is derived from',
        value: BASIS_WORDS.volume,
        note: 'Unlike the positioning levels, nothing here is weighted by gamma or by any greek.',
      },
      {
        label: 'What it cannot tell you',
        value: 'Direction, or who traded',
        note: 'A large print can be an opening buy, an opening sell, a hedge leg, or a roll. The chain records the trade, never the intent behind it.',
      },
      {
        label: 'The comparison not being made',
        value: 'Volume versus its own recent average',
        note: 'That is the better screen and it is not available here: the source publishes today’s volume but no history of it, so it would take a stored daily series this app does not keep. Stated rather than replaced with a worse proxy.',
      },
    ],
    assumption:
      'No dealer-positioning assumption is applied on this page. The ratio is a count divided by a count — it inherits none of the modelling that the gamma levels rest on, and equally none of their interpretation.',
    caveat: null,
    notes: [],
  };
}
