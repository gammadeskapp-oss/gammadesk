import { EXTENDED_PCT, type ScanRow } from './types';

/**
 * Saved views over the day's results.
 *
 * ## A preset never relaxes a rule
 *
 * This is the whole design constraint. A preset selects among names that have
 * *already cleared all five gates* and reorders them; it cannot admit a name
 * the rules rejected, and there is no preset that turns a gate into a
 * preference. The moment a preset can widen the list it stops being a view and
 * becomes a second, softer rule set hiding behind a dropdown — which is the
 * thing the strictness toggle was removed for.
 *
 * So every preset here is a *shape* question asked of the survivors: not "is
 * this a good name" — the gates answered that — but "where in its move is it".
 *
 * ## Calls only, deliberately
 *
 * There are no put presets in this branch and that is not an oversight. A put
 * preset is a screen for names to bet against, and the shape it would look for
 * — weakness into a level — is indistinguishable, to a beginner, from a name
 * sitting on support about to bounce. Buying puts into support is the most
 * expensive mistake this app could talk someone into, and the option-quality
 * gate that would have to catch the bad version of it has not been watched
 * through a real market yet. Puts wait until it has.
 */

export type PresetId = 'all' | 'continuation' | 'pullback';

export interface Preset {
  id: PresetId;
  label: string;
  /** What the preset is looking for, in one line, shown under the tabs. */
  description: string;
  /**
   * Whether a passing name fits this shape, and why.
   *
   * `reason` is rendered on the card, so a reader can see what the preset
   * selected on rather than trusting that it selected on something.
   */
  fits: (row: ScanRow) => { fits: boolean; reason: string };
}

/**
 * How close to the 20-day average counts as a pullback rather than a run.
 *
 * Names inside this band — or under the average outright, while still above
 * their 200-day — are the pullback shape. Everything further above it is
 * continuation. One boundary, so a name is in exactly one of the two and the
 * page cannot show the same ticker under two contradictory descriptions.
 */
export const PULLBACK_BAND_PCT = 2;

function pct(row: ScanRow): number | null {
  return row.extension.pctAbove20Ema;
}

export const SCANNER_PRESETS: Preset[] = [
  {
    id: 'all',
    label: 'All results',
    description:
      'Every name that cleared all five rules this morning, strongest first.',
    fits: () => ({ fits: true, reason: '' }),
  },
  {
    id: 'continuation',
    label: 'Bullish continuation',
    description:
      'Names already moving up and holding above their 20-day average — the trend is under way rather than starting.',
    fits: (row) => {
      const p = pct(row);
      if (p === null) {
        /*
         * Not a fit, and not a near-fit. Without the 20-day average there is no
         * way to say where in its move a name is, and a preset that admitted
         * unmeasured names would be selecting on nothing.
         */
        return {
          fits: false,
          reason: 'the 20-day average could not be read, so its position in the move is unknown',
        };
      }
      if (p <= PULLBACK_BAND_PCT) {
        return { fits: false, reason: 'sitting on its 20-day average rather than extending from it' };
      }
      return {
        fits: true,
        reason:
          p > EXTENDED_PCT
            ? `${p.toFixed(0)}% above its 20-day average — moving, and far enough to be called extended`
            : `${p.toFixed(0)}% above its 20-day average and still climbing`,
      };
    },
  },
  {
    id: 'pullback',
    label: 'Bullish pullback',
    description:
      'Names in an uptrend that have eased back to their 20-day average — the long trend is intact and the short-term run has cooled.',
    fits: (row) => {
      const p = pct(row);
      if (p === null) {
        return {
          fits: false,
          reason: 'the 20-day average could not be read, so its position in the move is unknown',
        };
      }
      if (p > PULLBACK_BAND_PCT) {
        return { fits: false, reason: `${p.toFixed(0)}% above its 20-day average — extending, not pulling back` };
      }
      return {
        fits: true,
        reason:
          p >= 0
            ? `within ${PULLBACK_BAND_PCT}% of its 20-day average, with the 200-day trend still up`
            : `${Math.abs(p).toFixed(0)}% below its 20-day average, with the 200-day trend still up`,
      };
    },
  },
];

export function presetById(id: string): Preset {
  return SCANNER_PRESETS.find((p) => p.id === id) ?? SCANNER_PRESETS[0];
}

/**
 * Apply a preset to rows that have already passed every gate.
 *
 * The caller is responsible for passing only survivors. This is stated rather
 * than defended in code because the type system cannot express it and a silent
 * re-check here would hide a caller that got it wrong.
 */
export function applyPreset(
  preset: Preset,
  passed: ScanRow[],
): Array<{ row: ScanRow; reason: string }> {
  return passed
    .map((row) => ({ row, ...preset.fits(row) }))
    .filter((entry) => entry.fits)
    .map(({ row, reason }) => ({ row, reason }));
}
