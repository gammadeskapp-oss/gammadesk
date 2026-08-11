/**
 * Plain-English explanations for every number the site puts on screen.
 *
 * This is the one file to edit to reword them. Nothing here is computed and
 * nothing imports anything, so changing the wording cannot break a page.
 *
 * `plain` is written for someone who has never traded an option: short
 * sentences, everyday words, an example wherever a number is involved. It is
 * what a beginner reads and it should stay that way.
 *
 * `detail` is the precise definition, shown smaller underneath. It exists so
 * the simple version does not have to carry the caveats — say the true thing
 * quietly rather than making the plain sentence hedge itself into uselessness.
 */

export interface Tooltip {
  /** Heading in the bubble; also the button's accessible name. */
  label: string;
  /** The beginner explanation. One or two short sentences. */
  plain: string;
  /** Optional exact definition for anyone who wants it. */
  detail?: string;
}

const ENTRIES = {
  // --- positioning summary --------------------------------------------------

  spot: {
    label: 'Spot',
    plain: 'The current price of the stock right now.',
    detail: 'Underlying price the greeks were calculated at.',
  },

  netGex: {
    label: 'Net GEX',
    plain:
      "How much 'calming padding' the market has today. Big + number = calm, bumps get softened. Negative = padding's off, moves get rough.",
    detail:
      'Total dealer gamma exposure across every strike and expiration shown, in dollars of hedging per 1% move.',
  },

  regime: {
    label: 'Gamma regime',
    plain:
      'Plain word for the mood. POSITIVE = calm day, moves fade. NEGATIVE = wild day, moves snowball.',
    detail:
      'Positive means dealer hedging leans against price moves; negative means it leans with them.',
  },

  flip: {
    label: 'Gamma flip',
    plain:
      'The line between calm and wild. Above it = calm. Below it = fast and jumpy. Watch this number.',
    detail: 'The price at which total dealer gamma changes sign.',
  },

  magnetAbove: {
    label: 'Magnet above',
    plain:
      'The nearest wall above price. Price gets pulled up toward it, then usually stalls there like a lid.',
    detail: 'Strike above spot carrying the largest absolute gamma exposure.',
  },

  magnetBelow: {
    label: 'Magnet below',
    plain:
      'The nearest floor below price. Price gets pulled down to it but often bounces there.',
    detail: 'Strike at or below spot carrying the largest absolute gamma exposure.',
  },

  // --- the four exposure tabs -----------------------------------------------

  gex: {
    label: 'GEX',
    plain:
      'The WHERE. Which price levels act like walls and magnets. Big number = strong wall = price stalls there.',
    detail: 'Gamma exposure: dollars of dealer hedging per +1% move in spot.',
  },

  vex: {
    label: 'VEX',
    plain: 'The FEAR one. Which levels start pulling if the market gets scared.',
    detail: 'Vanna exposure: dollars of dealer hedging per +1 point of implied volatility.',
  },

  cex: {
    label: 'CEX',
    plain:
      'The TIME one. The slow daily pull as the day/week runs out. Minus = pulls price down.',
    detail: 'Charm exposure: dollars of dealer hedging per calendar day of decay.',
  },

  oi: {
    label: 'Open interest',
    plain: 'How many option contracts are actually open at that price.',
    detail: 'Shown net: call open interest minus put open interest at that strike.',
  },

  // --- forecast -------------------------------------------------------------

  odds: {
    label: 'Odds higher',
    plain:
      'Out of 1,000 pretend futures, how many end higher. 60% = about 6 of 10 futures go up.',
    detail:
      'Share of simulated paths closing above today’s price at that horizon. A modelling lean, not a probability of the world.',
  },

  crash: {
    label: 'Big drop',
    plain:
      'Out of 1,000 pretend futures, how many had a big 8% drop somewhere along the way.',
    detail:
      'Paths trading 8% or more below spot at any point in the run. An underestimate, because volatility is held fixed.',
  },

  realisedVol: {
    label: 'Realised vol',
    plain:
      'How jumpy this stock has been lately. Higher = wilder swings. SPY ~14% is calm, 40%+ is bumpy, 100%+ is wild.',
    detail: '20-day realised volatility, annualised.',
  },

  // --- flow -----------------------------------------------------------------

  volOi: {
    label: 'Vol/OI',
    plain:
      'How many times more than normal this strike traded today. 600x = 600 times the usual — very unusual.',
    detail:
      'Today’s volume divided by the open interest carried into the session. It says something traded, not who traded it or why.',
  },
};

export type TooltipKey = keyof typeof ENTRIES;

/*
 * Widened to `Tooltip` deliberately. Inferred from the literal above, every
 * value would carry a required `detail`, and dropping that line from one entry
 * while rewording would then fail to compile somewhere else entirely.
 */
export const TOOLTIPS: Record<TooltipKey, Tooltip> = ENTRIES;

/** Stable order for the glossary on /guide. */
export const TOOLTIP_ORDER: TooltipKey[] = [
  'spot',
  'regime',
  'flip',
  'netGex',
  'magnetAbove',
  'magnetBelow',
  'gex',
  'vex',
  'cex',
  'oi',
  'odds',
  'crash',
  'realisedVol',
  'volOi',
];
