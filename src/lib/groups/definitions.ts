/**
 * Ticker groups shown on /groups.
 *
 * This is the file to edit to add your own. Add an entry, redeploy, and the
 * next refresh picks it up — nothing else needs changing. Every symbol here
 * also joins the breadth universe that feeds the market-internals strip and
 * the forecast's drift blend, so keep the list to names you actually want
 * counted.
 *
 * Symbols must be US-listed and match the same allow-list the ticker search
 * uses: letters, optionally followed by a dot or dash and a class suffix.
 */

export interface GroupDefinition {
  id: string;
  name: string;
  /** One line explaining what the group is, shown under the title. */
  blurb: string;
  symbols: string[];
}

export const GROUPS: GroupDefinition[] = [
  {
    id: 'mag7',
    name: 'MAG7',
    blurb: 'The megacap tech names that drive most of the index’s weight.',
    symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'],
  },
  {
    id: 'semi',
    name: 'SEMI',
    blurb: 'Semiconductors — the cyclical engine under the tech trade.',
    symbols: [
      'NVDA', 'AMD', 'AVGO', 'QCOM', 'MU',
      'TSM', 'INTC', 'AMAT', 'LRCX', 'KLAC',
    ],
  },
  {
    id: 'index',
    name: 'INDEX',
    blurb: 'The four major US index ETFs.',
    symbols: ['SPY', 'QQQ', 'IWM', 'DIA'],
  },
];

/** Every distinct symbol across all groups — the breadth universe. */
export function allTrackedSymbols(): string[] {
  return [...new Set(GROUPS.flatMap((g) => g.symbols))].sort();
}
