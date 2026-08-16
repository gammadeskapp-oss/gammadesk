/**
 * Plain-language explanations for every number the site puts on screen.
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

  // --- flow column headers ---------------------------------------------------
  //
  // Kept out of TOOLTIP_ORDER below: the glossary on /guide is for concepts,
  // and a reader there does not need a definition of a column called "Ticker".

  flowTicker: {
    label: 'Ticker',
    plain: 'Which stock or ETF the option is on.',
  },

  flowExpiry: {
    label: 'Expiry',
    plain:
      'The date the option runs out. After that day it stops existing, worth something or nothing.',
  },

  flowStrike: {
    label: 'Strike',
    plain:
      'The price the option is pinned to. It only pays off if the stock ends up past this price.',
  },

  flowType: {
    label: 'Type',
    plain:
      'CALL pays off if price goes up, PUT if it goes down — but either can also be someone protecting what they already own.',
  },

  flowVolume: {
    label: 'Volume',
    plain: 'How many of these contracts changed hands today.',
  },

  flowOpenInterest: {
    label: 'Open interest',
    plain:
      'How many were already sitting open before today started. Today’s trading is compared against this.',
    detail: 'Settled overnight, so it does not include any of today’s activity.',
  },

  flowFlag: {
    label: 'Flag',
    plain:
      'How unusual it is, at a glance. NOTABLE is busy, HIGH is very busy, EXTREME is the rare stuff.',
  },

  flowWhat: {
    label: 'What happened',
    plain: 'The row written out in one plain sentence, so you do not have to read the numbers.',
  },

  flowSpot: {
    label: 'Spot',
    plain: 'What the stock itself costs right now.',
  },

  flowChainVolume: {
    label: 'Chain volume',
    plain: 'Every option contract traded on this stock today, added together.',
  },

  flowChainOi: {
    label: 'Open interest (chain)',
    plain: 'Every option contract currently open on this stock, added together.',
  },

  flowPutCallVolume: {
    label: 'Put/call volume',
    plain:
      'Puts traded divided by calls traded. Above 1 means more puts than calls changed hands today.',
    detail:
      'A common nervousness gauge, and a crude one — puts are bought as insurance at least as often as they are bets.',
  },

  flowPremium: {
    label: 'Premium',
    plain:
      'The dollars that actually changed hands on this contract today — how many traded, times what each cost.',
    detail:
      'Volume x price x 100, priced off the mid where both sides are quoted and the last trade otherwise. Shown as a dash when neither is available, rather than as zero.',
  },

  flowFlagged: {
    label: 'Flagged',
    plain: 'How many strikes on this stock were unusual enough to make the list above.',
  },

  // --- /decision, advanced view ---------------------------------------------
  //
  // The context labels there reuse `regime`, `flip`, `magnetAbove` and
  // `magnetBelow` above rather than restating them, so the same number never
  // gets two different explanations.

  wallsAbove: {
    label: 'Walls above',
    plain: 'Ceilings overhead — price stalls when it rises into these.',
  },

  wallsBelow: {
    label: 'Walls below',
    plain: 'Floors underneath — price often bounces at these.',
  },

  wallStrength: {
    label: 'Strength %',
    plain:
      'How strong this wall is vs the biggest wall on the SAME side. 100% = the strongest on that side (not stronger than the other side).',
  },

  wallDollar: {
    label: 'Wall strength',
    plain:
      'Wall strength — how hard dealers must hedge here. Bigger = stronger wall. Not money sitting there.',
  },

  wallColour: {
    label: 'Amber vs blue',
    plain:
      'Amber = calm (dealers push back against moves). Blue = wild (dealers speed moves up).',
  },

  convFirstTouch: {
    label: 'First touch',
    plain:
      'A level is freshest the first time price tests it, and weaker each time after. 1st touch = cleanest reaction.',
  },

  convHowFar: {
    label: 'How far',
    plain:
      'How far price traveled to get here. A big move means momentum is spent, so a bounce is more likely.',
  },

  convHowFast: {
    label: 'How fast',
    plain:
      'How quickly price arrived. Fast moves burn out fast — a sharp bounce is more likely.',
  },

  verdict: {
    label: 'Verdict',
    plain:
      'A summary of conditions in plain words — never a buy/sell call. Your own trigger still decides the entry.',
  },

  // --- sector momentum -------------------------------------------------------

  sectorScore: {
    label: 'Score',
    plain:
      'How many of the nine health checks the average stock in this sector is passing, out of 100. 70 means most look healthy.',
    detail:
      'The same nine signals used on the ticker page, averaged across the sector’s members.',
  },

  sectorDelta: {
    label: 'Δ1D / Δ3D / Δ5D',
    plain:
      'How much the score moved since 1, 3 and 5 trading days ago. +8 means the sector is eight points healthier than it was. It is the change that matters here, not the level.',
  },

  sectorSpark: {
    label: 'Trend line',
    plain:
      'The last ten days of the score, drawn small. Rising line = getting healthier, falling = getting weaker.',
  },

  sectorAccelerating: {
    label: 'Accelerating',
    plain:
      'Sectors getting healthier fastest. Often where money is moving in — but it means buyers have already been busy, not that you should chase.',
  },

  sectorDecelerating: {
    label: 'Decelerating',
    plain:
      'Sectors getting weaker fastest. Often where money is leaving. A falling score is not the same as a cheap price.',
  },

  sectorBottoming: {
    label: 'Bottoming + turning',
    plain:
      'This sector was beaten down recently and its score has started climbing again. Worth watching — plenty of these turns fail.',
    detail:
      'Average RSI dipped to 35 or lower in the last ten sessions and the 3-day change is now positive.',
  },

  sectorTopping: {
    label: 'Topping + rolling over',
    plain:
      'This sector ran hot recently and its score has started falling. A reason to be careful, not a reason to sell.',
    detail:
      'Average RSI reached 65 or higher in the last ten sessions and the 3-day change is now negative.',
  },

  // --- relative strength -----------------------------------------------------

  rsScore: {
    label: 'RS Score',
    plain:
      '0-100 rank vs the other 499. 90 = stronger than 90% of the market.',
    detail:
      'A weighted blend of the stock’s percentile rank over 1, 3 and 6 months. Always ranked against the whole index, never against the group you have filtered to.',
  },

  rsLeaders: {
    label: 'Leaders',
    plain:
      'Strongest names now — money flowing in. A research shortlist, not a buy.',
    detail:
      'The top of the ranking. It says these have outperformed, which is a fact about the past, not a forecast.',
  },

  rsLaggards: {
    label: 'Laggards',
    plain:
      'Weakest names — money leaving. Don’t buy just because they look cheap.',
    detail:
      'The bottom of the ranking. A low score is a statement about relative performance, not about valuation.',
  },

  rsTrend: {
    label: 'Rising / Falling RS',
    plain:
      'Climbing or dropping in the ranks this week. Rising = gaining strength.',
    detail:
      'Today’s score minus the same score five sessions ago. Because the rank is relative, it can fall while the stock rises — that just means the rest of the market rose more.',
  },

  rsWindows: {
    label: '1mo / 3mo / 6mo',
    plain:
      'Performance over each window. Blended so one hot week can’t fool it.',
    detail:
      'Measured over 21, 63 and 126 trading sessions. The table shows the percentile rank for each; the raw return sits underneath it.',
  },

  rsVolume: {
    label: 'Confirmed / Unconfirmed',
    plain:
      "A price move on high volume is real — money's behind it. A move on low volume is weak and can reverse. 'Confirmed' = the strength has buying volume.",
    detail:
      'Compares the last month’s average volume against the three months before it. It describes the move, not the direction — a laggard marked confirmed is falling on heavy volume, which makes the weakness more credible, not less.',
  },

  rsLiquidity: {
    label: 'Liquidity floor',
    plain:
      'Skips stocks that barely trade. $10M a day means at least ten million dollars of stock changes hands on an average day.',
    detail:
      'Average daily dollar turnover over 20 sessions. Applied before ranking, so a thin name cannot take a percentile place from a tradeable one.',
  },

  rsRsi: {
    label: 'RSI (14)',
    plain:
      'RSI measures if a stock is overbought or oversold vs its OWN recent moves (0-100). Over 70 = stretched high, maybe due a pullback. Under 30 = stretched low. This is different from RS, which compares the stock to the whole market.',
    detail:
      'Wilder’s Relative Strength Index over 14 of the stock’s own trading sessions — the same RSI(14) the /ticker chart draws. A leader can sit above 70 for months in a strong trend, so it is a stretch reading rather than a sell signal.',
  },

  rsSignalScore: {
    label: 'Nine-signal score',
    plain:
      'A different question: is this stock’s own trend healthy? RS asks whether it is beating the market.',
    detail:
      'The share of the nine /ticker checks voting bullish, 0-100. Computed by the /sectors and /groups jobs, which cover a smaller universe — so most names show a dash.',
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
  'rsScore',
  'rsTrend',
  'rsWindows',
  'rsVolume',
  'rsRsi',
  'rsLiquidity',
  'rsLeaders',
  'rsLaggards',
];
