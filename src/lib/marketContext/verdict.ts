import { breadthBand, type BreadthBand } from '../breadth/compute';

/**
 * One sentence combining breadth and the VIX.
 *
 * ## Why this is a pure function in its own file
 *
 * It is the only place on the site where two independent readings are joined
 * into a single claim, which makes it the easiest place to accidentally say
 * something neither reading supports. Kept pure so `verify:context` can walk
 * every combination and check that none of them predicts anything.
 *
 * ## The shape of every sentence
 *
 * Observation, then consequence for how confidently to read a move — never a
 * direction. "Fewer stocks participating" is a fact about the tape. "Treat
 * upside breaks with lower confidence" is advice about certainty, not about
 * what to buy. Nothing here may cross into the second kind.
 */

export interface VerdictInput {
  /** Percentage of the S&P 500 above its prior close, or null with no reading. */
  breadthPct: number | null;
  /** The VIX's percentage change on the session, or null when unavailable. */
  vixChangePct: number | null;
}

/**
 * How much VIX movement counts as a direction rather than noise.
 *
 * The index routinely wobbles a percent on nothing. Below this the sentence
 * says "steady" rather than picking a side, because a verdict that calls a
 * 0.3% drift "rising" teaches the reader to discount the whole line.
 */
export const VIX_FLAT_PCT = 1.5;

type VixMove = 'rising' | 'easing' | 'steady';

function vixMove(changePct: number | null): VixMove | null {
  if (changePct === null) return null;
  if (Math.abs(changePct) < VIX_FLAT_PCT) return 'steady';
  return changePct > 0 ? 'rising' : 'easing';
}

const BREADTH_WORDS: Record<BreadthBand, string> = {
  high: 'Breadth is broad',
  middle: 'Breadth is middling',
  low: 'Breadth is weak',
};

const VIX_WORDS: Record<VixMove, string> = {
  rising: 'VIX is rising',
  easing: 'VIX is easing',
  steady: 'VIX is steady',
};

/**
 * The consequence half, keyed on the pair.
 *
 * Written out per combination rather than assembled from fragments. Four
 * fragments joined by rules produce sentences nobody has read; nine written
 * sentences are nine things that can be checked.
 */
const CONSEQUENCE: Record<BreadthBand, Record<VixMove, string>> = {
  low: {
    rising:
      'fewer stocks participating while the market pays up for protection. Treat upside breaks with lower confidence.',
    easing:
      'fewer stocks participating despite the calm. The index is being carried by a narrow group, which the quiet volatility does not show.',
    steady:
      'fewer stocks participating. An index move on narrow participation says less about the market than its size suggests.',
  },
  middle: {
    rising:
      'participation is unremarkable and the market is paying up for protection. Nothing in the pair argues for reading moves more confidently.',
    easing:
      'participation is unremarkable and protection is getting cheaper. Neither reading stands out.',
    steady: 'neither reading stands out today.',
  },
  high: {
    rising:
      'most stocks are taking part, but the market is still paying up for protection. The two disagree, so treat either one alone as weaker evidence.',
    easing:
      'most stocks are taking part and protection is getting cheaper. Moves have more of the market behind them than usual.',
    steady:
      'most stocks are taking part. Moves have more of the market behind them than usual.',
  },
};

/**
 * @returns the sentence, or an honest statement of what is missing. Never
 * null — a context row that silently drops its conclusion when one input is
 * absent leaves the reader to supply their own, which is the failure this line
 * exists to prevent.
 */
export function contextVerdict(input: VerdictInput): string {
  const { breadthPct, vixChangePct } = input;
  const move = vixMove(vixChangePct);

  if (breadthPct === null && move === null) {
    return 'No breadth reading and no VIX quote yet, so there is no combined read to give.';
  }

  if (breadthPct === null) {
    return `${VIX_WORDS[move as VixMove]}, but there is no breadth reading yet — so how much of the market is taking part is unknown, not average.`;
  }

  if (move === null) {
    const band = breadthBand(breadthPct);
    return `${BREADTH_WORDS[band]} at ${Math.round(breadthPct)}%, and there is no VIX quote to read it against.`;
  }

  const band = breadthBand(breadthPct);
  return `${BREADTH_WORDS[band]} and ${VIX_WORDS[move]} — ${CONSEQUENCE[band][move]}`;
}
