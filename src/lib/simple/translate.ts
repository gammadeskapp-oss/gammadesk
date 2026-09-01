import { formatStrike } from '../format';

/**
 * Turns the positioning book into plain language.
 *
 * The rule for this file: no jargon reaches the output. Not "gamma", not
 * "GEX", not "dealer". Everything a beginner sees on the default view is
 * produced here, so there is one place to check that promise and one place to
 * reword it.
 *
 * One word was let back in deliberately — "hedging", in the two level labels.
 * The labels used to read "Stalls going up" and "Bounces going down", which
 * are jargon-free and also assertions the book cannot support: they name an
 * outcome. "Possible resistance / hedging response area" names the mechanism
 * and marks it possible. A reader who does not know the word learns nothing
 * false from it, which was not true of the old pair.
 *
 * Pure and input-only, so the homepage and /decision cannot drift into saying
 * different things about the same book.
 */

export interface SimpleInput {
  symbol: string;
  regime: 'positive' | 'negative';
  flipLevel: number | null;
  /** Price is above the flip. Null when there is no flip nearby. */
  aboveFlip: boolean | null;
  magnetAbove: number | null;
  magnetBelow: number | null;
}

export interface SimpleRow {
  label: string;
  value: string;
  /** True when the underlying number was missing. */
  missing: boolean;
}

export interface SimpleRead {
  mood: 'calm' | 'wild';
  emoji: string;
  headline: string;
  sentence: string;
  rows: SimpleRow[];
  watch: string;
  /**
   * Set when the book says one thing and the flip says another, so the page
   * can show it rather than quietly picking a side.
   */
  conflict: string | null;
}

/**
 * Calm needs both: the book leaning against moves *and* price on the calm side
 * of the flip.
 *
 * Those normally agree — the flip is defined as where the lean changes sign —
 * so when they disagree the data is telling us price is sitting right on the
 * boundary. Reading that as wild is the cautious way round, and the
 * disagreement is surfaced rather than swallowed.
 *
 * Exported, and narrowed to the two fields it actually reads, because the home
 * page needs the same verdict to pick its research line and must not reach it
 * by a second route — see `lib/simple/research.ts`.
 */
export function moodOf(
  input: Pick<SimpleInput, 'regime' | 'aboveFlip'>,
): 'calm' | 'wild' {
  if (input.regime === 'negative') return 'wild';
  return input.aboveFlip === false ? 'wild' : 'calm';
}

const dash = '—';

export function buildSimpleRead(input: SimpleInput): SimpleRead {
  const mood = moodOf(input);
  const calm = mood === 'calm';

  const above = input.magnetAbove === null ? null : formatStrike(input.magnetAbove);
  const below = input.magnetBelow === null ? null : formatStrike(input.magnetBelow);
  const flip = input.flipLevel === null ? null : formatStrike(input.flipLevel);

  /*
   * Two sentences, not one template.
   *
   * The flip clause is false once price is already under the flip, and the
   * whole point of this view is that a beginner can trust what it says. When
   * the tape is already wild it gets told the way back instead.
   *
   * ## Why the wording is this careful
   *
   * The sentences used to read "Likely drifts between X and Y" and "Gets wild
   * only under X". Both are predictions, and neither is one the book can
   * actually make: positioning describes where hedging pressure sits, not what
   * price will do. "Consistent with" and "raises the odds of" say the same
   * thing about the same book without promising an outcome, and that is the
   * difference between a description and a forecast.
   */
  let sentence: string;
  if (calm) {
    sentence =
      above && below
        ? `Positioning is consistent with range-bound trading between ${below} and ${above}.`
        : above
          ? `Positioning is consistent with range-bound trading below ${above}.`
          : below
            ? `Positioning is consistent with range-bound trading above ${below}.`
            : 'Positioning is consistent with range-bound trading rather than a sustained move.';
    if (flip) {
      sentence += ` A sustained move below ${flip} raises the odds of larger swings.`;
    }
  } else {
    sentence =
      above && below
        ? `Positioning is consistent with larger swings, roughly between ${below} and ${above}.`
        : 'Positioning is consistent with larger swings.';
    // The mirror of the calm clause, and it has to move in the same direction:
    // back above the flip is the condition that reduces the odds, not raises
    // them.
    if (flip) {
      sentence += ` A sustained move back above ${flip} lowers the odds of larger swings.`;
    }
  }

  const rows: SimpleRow[] = [
    {
      label: 'Possible resistance / hedging response area',
      value: above ?? dash,
      missing: above === null,
    },
    {
      label: 'Possible support / hedging response area',
      value: below ?? dash,
      missing: below === null,
    },
    {
      label: 'Flips calm to wild',
      value: flip ?? dash,
      missing: flip === null,
    },
  ];

  const watch = calm
    ? `Positioning is consistent with price holding between the levels above and below rather than breaking out, so chasing a move is the main way to get hurt today.${
        flip ? ` Watch ${flip}. A sustained move below it may increase the chance of larger swings.` : ''
      }`
    : `Moves can keep going instead of fading, so be careful and give price room.${
        flip ? ` Watch ${flip}. A sustained move above it may reduce the chance of larger swings.` : ''
      }`;

  const conflict =
    input.regime === 'positive' && input.aboveFlip === false && flip
      ? `The book still leans calm, but price has slipped under ${flip}. Treat the calm as fragile until it climbs back.`
      : null;

  return {
    mood,
    emoji: calm ? '🟡' : '🔴',
    headline: `${input.symbol} today: ${calm ? '🟡 Calm' : '🔴 Wild'}`,
    sentence,
    rows,
    watch,
    conflict,
  };
}
