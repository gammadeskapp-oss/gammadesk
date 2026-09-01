import { breadthBand, type BreadthBand } from '../breadth/compute';

/**
 * The one research line under the verdict on the front door.
 *
 * ## What this line is, and what it must never become
 *
 * It sits directly under the biggest claim on the site, in the place a reader
 * looks for "so what do I do". That makes it the single most dangerous
 * sentence in the app, so it is written to answer a different question: how
 * carefully should you read today, and what would have to happen before a move
 * meant something.
 *
 * Every sentence here is therefore an instruction about *research* — be picky,
 * wait for confirmation, want more proof — and never about *position*. No buy,
 * no sell, no direction, no size. `verify:research` walks all eight
 * combinations and checks exactly that.
 *
 * ## Why it takes the mood rather than the regime
 *
 * The headline it sits under says Calm or Wild, and that word comes from
 * `translate.ts`'s `mood`, which is not the raw gamma sign — a positive-gamma
 * day under its flip reads as wild. Keying this line on the same value is what
 * stops the front door from saying "Wild" in large type and then reasoning
 * about a calm day two lines below it.
 */

export type Mood = 'calm' | 'wild';

export interface ResearchInput {
  mood: Mood;
  /** Share of the S&P 500 above its prior close, or null with no reading. */
  breadthPct: number | null;
}

/**
 * Written out per combination rather than assembled from clauses.
 *
 * Same reasoning as `marketContext/verdict.ts`: fragments joined by rules
 * produce sentences nobody has read, and this is not a line to discover a bad
 * phrasing in after it has shipped.
 */
const LINES: Record<Mood, Record<BreadthBand | 'unknown', string>> = {
  wild: {
    low: 'Wild day with weak breadth — be picky, and wait for a level to hold before trusting a move.',
    middle:
      'Wild day and only average participation — wait for a level to hold before trusting a move.',
    high: 'Wild day, but most of the market is taking part — moves have real backing today; still let a level hold before reading much into one.',
    unknown:
      'Wild day, and no breadth reading to check it against — treat any single move as weaker evidence until a level holds.',
  },
  calm: {
    low: 'Calm day but weak breadth — the quiet is being carried by a narrow group, so a break of a level needs more proof than usual before it means anything.',
    middle:
      'Calm day with average participation — the levels above and below are the frame; what to study is how price behaves when it reaches one.',
    high: 'Calm day with most of the market taking part — the levels above and below are the frame, and a decisive break of one is the thing worth examining.',
    unknown:
      'Calm day, with no breadth reading to check it against — the levels above and below are still the frame, but hold the reading loosely.',
  },
};

export function researchLine(input: ResearchInput): string {
  const band = input.breadthPct === null ? 'unknown' : breadthBand(input.breadthPct);
  return LINES[input.mood][band];
}
