import { formatStrike } from '../format';

/**
 * Turns the positioning book into plain English.
 *
 * The rule for this file: no jargon reaches the output. Not "gamma", not
 * "GEX", not "dealer". Everything a beginner sees on the default view is
 * produced here, so there is one place to check that promise and one place to
 * reword it.
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
 */
function moodOf(input: SimpleInput): 'calm' | 'wild' {
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
   * "Gets wild only under X" is false once price is already under X, and the
   * whole point of this view is that a beginner can trust what it says. When
   * the tape is already wild it gets told the way back instead.
   */
  let sentence: string;
  if (calm) {
    sentence =
      above && below
        ? `Likely drifts between ${below} and ${above}.`
        : above
          ? `Likely drifts up toward ${above}.`
          : below
            ? `Likely drifts down toward ${below}.`
            : 'Likely drifts rather than runs.';
    if (flip) sentence += ` Gets wild only under ${flip}.`;
  } else {
    sentence =
      above && below
        ? `Moves can run instead of stopping, roughly between ${below} and ${above}.`
        : 'Moves can run instead of stopping.';
    if (flip) sentence += ` It settles down again above ${flip}.`;
  }

  const rows: SimpleRow[] = [
    {
      label: 'Stalls going up',
      value: above ?? dash,
      missing: above === null,
    },
    {
      label: 'Bounces going down',
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
    ? `Price tends to drift between the levels above and below rather than break out, so chasing a move is the main way to get hurt today.${
        flip ? ` Watch ${flip} — under it, this changes.` : ''
      }`
    : `Moves can keep going instead of fading, so be careful and give price room.${
        flip ? ` Watch ${flip} — back above it, this calms down.` : ''
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
