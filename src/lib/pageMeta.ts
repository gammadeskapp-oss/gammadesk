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
    'Context, levels, and conviction check for one ticker.',
  '/sectors':
    'Which parts of the market the models currently rate strongest and weakest.',
  '/':
    'Where dealers are exposed on any optionable ticker, and the levels where dealer hedging may influence price.',
  '/velocity':
    'How fast dealer positioning is shifting — slow drift or sudden change.',
  '/forecast':
    'Scenario price levels from positioning and market inputs. Not a prediction.',
  '/montecarlo':
    'Thousands of simulated price paths, to show the spread of outcomes.',
  '/flow': 'Unusual options activity, ranked by size relative to the usual.',
  '/movers':
    'S&P 500 names that closed up on heavy volume in the last completed session, with the context to check each one against. Not a scanner result.',
  '/scanner':
    "This morning's S&P 500 names that pass all five rules, each with its option contract graded.",
  '/scanner/history':
    'Every past morning the scanner ran, and how many names it produced each day.',
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
  '/analogues':
    'Past sessions on one ticker that met the same test, and what followed them — including the times it went badly.',
  '/history':
    'The last 30 sessions, with the levels recorded each morning drawn on the day they belonged to.',
  '/methodology':
    'What every number here is built from, and the assumption it all rests on.',
  '/status':
    'Every scheduled job, when it last succeeded, and whether anything is behind.',
};

export function pageDescription(route: string): string | undefined {
  return PAGE_DESCRIPTIONS[route];
}
