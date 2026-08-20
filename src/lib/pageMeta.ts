/**
 * One line per page, saying what it is for.
 *
 * Shown twice, from this one source: as a subtitle under each page's heading,
 * which everyone sees, and as the `title` on the sidebar link, which is a
 * desktop-hover convenience only. Nothing important is hover-only — the
 * tooltip repeats the subtitle rather than adding to it.
 *
 * Written from the reader's side: what the page tells you, not how it is
 * computed.
 */

export const PAGE_DESCRIPTIONS: Record<string, string> = {
  '/dashboard':
    "Today's market backdrop in one screen — regime, breadth, and what's moving.",
  '/decision':
    'One ticker, everything that matters: context, levels, conviction, chart or forecast, and the exposure tables.',
  '/sectors':
    'Which parts of the market the models currently rate strongest and weakest.',
  '/':
    'Where dealers are exposed on any optionable ticker, and which price levels that exposure pulls toward.',
  '/velocity':
    'How fast dealer positioning is shifting — slow drift or sudden change.',
  '/forecast':
    'A range of where price could land, with the odds attached. Not a prediction.',
  '/montecarlo':
    'Thousands of simulated price paths, to show the spread of outcomes.',
  '/flow': 'Unusual options activity, ranked by size relative to the usual.',
  '/scanner':
    "This morning's S&P 500 names that pass every filter, checked on three timeframes.",
  '/strength':
    "Every S&P 500 stock ranked by how much it's beating the market — leaders and laggards.",
  '/watchlist': "The tickers you're tracking, with their current readings.",
  '/log':
    "How the model's past calls actually turned out. Kept honest on purpose.",
  '/ticker':
    'Nine independent checks on any US ticker, and how easily it actually trades.',
  // One page, two halves: the written summary and the postable version of it.
  // `/digest` and `/post` redirect here and keep their entries so an old link
  // that reaches for a description still finds one.
  '/daily':
    "The whole day in a few sentences, plus the six-line version ready to post.",
  '/digest': "The whole day in a few sentences, written out once after the close.",
  '/post': "Today's positioning as a six-line post, ready to copy or send.",
  '/guide': 'What everything here means, for someone new to the market.',
};

export function pageDescription(route: string): string | undefined {
  return PAGE_DESCRIPTIONS[route];
}
