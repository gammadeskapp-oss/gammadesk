/**
 * The sentences beside the numbers.
 *
 * Client-safe and deliberately pure. `score.ts` decides what a row's readings
 * amount to at the reader's settings; this file writes the plain-English
 * account of them, so the badges, the watch line and the detail row are all
 * derived from one set of numbers and cannot disagree with each other.
 *
 * ## Nothing here is a verdict
 *
 * It used to hold `evaluateRow`, `partition` and the four alignment badges —
 * all of which resolved *stored* pass/fail states into a pass list. There is
 * no pass list any more. Every one of the 503 scored names is ranked and the
 * top of the ranking is always rendered, with each of its filters shown
 * green or red against thresholds the reader owns. So the judging moved to
 * `score.ts`, where it is a function of the reader's settings, and what is
 * left here is the writing.
 */

import { EXTENDED_PCT, type ScanRow } from './types';
import { contractSummary } from './optionQuality';
import {
  describeTrendParts,
  SCORE_KEYS,
  type FilterSettings,
  type RowScore,
  type ScoreKey,
  type ScoredRow,
} from './score';

// --- the watch line ----------------------------------------------------------

/**
 * The risks attached to one row.
 *
 * ## Why this can never return nothing
 *
 * A result rendered with no watch line reads as a result with nothing to
 * watch. That is a claim, and usually a false one. So when nothing is flagged
 * this says so explicitly, and the board renders it either way — the empty
 * case is a sentence, not an absence.
 *
 * Order is worst-first: the reader's attention goes to the top of the list, so
 * the thing most likely to cost them something has to be there.
 */
export function buildWatchLine(
  row: ScanRow,
  bufferDays: number,
): { items: string[]; text: string } {
  const items: string[] = [];

  // --- earnings -------------------------------------------------------------
  const { earnings } = row;
  if (earnings.state === 'unknown') {
    /*
     * Stated out loud, every time. An unknown earnings date is not a distant
     * one, and a reader who sees no earnings note on a result will reasonably
     * assume there is no report coming. This line is the whole reason an
     * unknown name is allowed onto the page at all.
     */
    items.push('earnings date unknown — a report inside the next two weeks cannot be ruled out');
  } else if (earnings.daysAway !== null && earnings.dateIso !== null) {
    if (earnings.daysAway >= 0 && earnings.daysAway <= bufferDays) {
      items.push(
        `earnings in ${earnings.daysAway} day${earnings.daysAway === 1 ? '' : 's'} (${earnings.dateIso}) — inside your ${bufferDays}-day buffer`,
      );
    } else if (earnings.daysAway >= 0 && earnings.daysAway <= 30) {
      items.push(`earnings in ${earnings.daysAway} days`);
    }
  }

  // --- extension ------------------------------------------------------------
  const { extension } = row;
  if (extension.extended && extension.pctAbove20Ema !== null) {
    items.push(
      `${extension.pctAbove20Ema.toFixed(0)}% above the 20-day average (extended)`,
    );
  }

  // --- the contract ---------------------------------------------------------
  const quality = row.optionQuality;
  if (quality) {
    if (quality.badge === 'avoid') {
      items.push('the option contract itself scored Avoid');
    } else if (quality.badge === 'caution') {
      items.push('the option contract scored Caution');
    } else if (quality.badge === 'unknown') {
      items.push('the option contract could not be graded');
    }
  } else {
    items.push('the option contract has not been checked — unknown, not cleared');
  }

  // --- the single-name gamma caveat ----------------------------------------
  if (row.regime === 'negative') {
    items.push(
      "this name's own dealer positioning reads negative, which is context rather than a rule",
    );
  }

  return {
    items,
    text: items.length > 0 ? items.join('; ') : 'Nothing flagged beyond the usual.',
  };
}

// --- why it is where it is ---------------------------------------------------

/** One labelled line of the plain-English account of a row. */
export interface MatchLine {
  label: string;
  text: string;
}

/**
 * The account of one row, in the order someone would ask for it.
 *
 * Trend, then strength, then participation, then the contract, then the risks.
 * Written from the same verdicts the badges are drawn from, so the sentence
 * and the colour beside it cannot come apart — which was the point of doing
 * both from one place.
 *
 * The heading is deliberately not "why it matched". Most rows on this page did
 * not match; they are simply the closest things to matching, and a label that
 * said otherwise would be the page recommending them.
 */
export function whyItRanks(scored: ScoredRow, settings: FilterSettings): MatchLine[] {
  const { row, verdicts } = scored;

  const lines: MatchLine[] = [
    { label: 'Trend', text: verdicts.trend.detail },
    {
      label: 'Strength',
      text: `${verdicts.rs.detail} — #${row.metrics.rsRank} in the index`,
    },
    { label: 'Volume', text: verdicts.volume.detail },
    { label: 'Liquidity', text: verdicts.liquidity.detail },
  ];

  const quality = row.optionQuality;
  lines.push({
    label: 'Options',
    text: quality
      ? `${contractSummary(quality.contract)} — ${titleCase(quality.badge)}`
      : 'not checked — only the top names by score are graded at scan time; open this one to grade it',
  });

  lines.push({ label: 'VWAP', text: verdicts.vwap.detail });
  lines.push({ label: 'Gamma', text: verdicts.gamma.detail });
  lines.push({ label: 'Market', text: verdicts.spy.detail });
  lines.push({ label: 'Watch', text: buildWatchLine(row, settings.earningsBufferDays).text });

  return lines;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// --- extension ---------------------------------------------------------------

/** Extension, computed from a close and its 20-day average. Null-safe. */
export function readExtension(
  close: number | null,
  ema20: number | null,
): { pctAbove20Ema: number | null; ema20: number | null; extended: boolean } {
  if (close === null || ema20 === null || !(ema20 > 0)) {
    // Unreadable is not extended. Flagging a name on a missing average would
    // be a warning made entirely out of a gap in the data.
    return { pctAbove20Ema: null, ema20, extended: false };
  }
  const pct = ((close - ema20) / ema20) * 100;
  return { pctAbove20Ema: pct, ema20, extended: pct > EXTENDED_PCT };
}


// --- the one-line account ----------------------------------------------------

/**
 * A component scoring at or above this is described as a strength.
 *
 * Not a pass mark. Nothing here decides whether a name is on the list — the
 * ranking does that — this only decides which readings are worth naming in one
 * sentence. Set where it is because a component below 65 is a middling
 * reading, and a sentence that called it a reason would be flattering the row.
 */
const STRONG = 65;

/** How many reasons one line will carry before it stops being readable. */
const MAX_REASONS = 4;

/**
 * The plain-English reason a name is where it is, in one sentence.
 *
 * ## Built from the numbers, never written for the row
 *
 * Every clause comes from a component that actually scored above `STRONG`, in
 * descending order, so the sentence and the columns beside it cannot disagree.
 * There is no hand-written copy per name and no template that fires on a
 * name's identity.
 *
 * ## What it must never become
 *
 * It is an account of readings, not a case for a position. It never says buy,
 * sell, enter, target, or size, and the board renders the row's cautions
 * immediately beside it — not below a fold, not behind a toggle. A page that
 * shows the green reasons and hides the red ones has stopped describing and
 * started selling.
 *
 * When nothing clears `STRONG` this says so. That is the honest answer for a
 * row that is on screen only because twenty other names had to be ranked
 * somewhere, and inventing a reason for it would be the single most misleading
 * thing this line could do.
 */
export function whyItMatched(score: RowScore, row: ScanRow): string {
  const reasons = SCORE_KEYS
    .map((key) => ({ key, value: score.components[key] }))
    .filter(
      (entry): entry is { key: ScoreKey; value: number } =>
        entry.value !== null && entry.value >= STRONG,
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_REASONS)
    .map((entry) => REASON[entry.key](score, row));

  if (reasons.length === 0) {
    return 'Nothing here scores strongly. It is on the list because the ranking has to put twenty names on screen and this one came out above the rest — not because any single reading stands out.';
  }

  return `${sentenceCase(reasons.join(', '))}. Worth watching, and nothing more than that.`;
}

/**
 * One clause per component.
 *
 * Written as observations rather than judgements — "above its 200-day average"
 * is a fact anyone can check on a chart, "in a strong uptrend" is a verdict
 * dressed as one.
 */
const REASON: Record<ScoreKey, (score: RowScore, row: ScanRow) => string> = {
  rs: (_score, row) =>
    `strong relative strength against the index (RS ${row.metrics.rsScore.toFixed(0)}, #${row.metrics.rsRank})`,
  // The trend clause names the readings behind the sub-score rather than the
  // sub-score itself: "trend 88" tells a reader nothing they can check.
  trend: (score) => describeTrendParts(score.trend),
  volume: (_score, row) =>
    row.metrics.volumeRatio === null
      ? 'volume above its own average'
      : `volume ${row.metrics.volumeRatio.toFixed(2)}x its own average`,
  vwap: (_score, row) =>
    row.metrics.pctAboveVwap === null
      ? 'above its 20-session VWAP'
      : `${row.metrics.pctAboveVwap.toFixed(1)}% above its 20-session VWAP`,
  tickerGamma: () => 'its own dealer positioning reads positive',
  spyGamma: () => "the wider market's dealer positioning reads positive",
  optionLiquidity: () => 'options that trade in size',
};

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
