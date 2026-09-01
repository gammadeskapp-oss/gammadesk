/**
 * "Continue your research" — the card grid at the bottom of the front door,
 * and the same grid inside the mobile menu.
 *
 * ## Why the labels here are not the nav labels
 *
 * The sidebar names pages. This names *questions*. Someone who has just read
 * "SPY today: Wild" does not know they want the strength board; they know they
 * want to find out whether the rest of the market agrees. "Market health — Is
 * the broader market confirming this?" answers that; "Dashboard" does not.
 *
 * So each entry carries both: the label a reader scans for, and the question
 * that tells them why they would click it. Neither is derived from
 * `PAGE_DESCRIPTIONS`, which is written from the other direction — what the
 * page contains, for someone already on it.
 *
 * ## Why every href is a route that already exists
 *
 * This grid is navigation, not a roadmap. A card that leads nowhere on the one
 * screen a first-time reader is guaranteed to see is worse than no card, so
 * nothing may be listed here before the page behind it is live.
 */

export interface ResearchCard {
  href: string;
  /** What the reader scans for. */
  label: string;
  /** Why they would click it, phrased as the question the page answers. */
  question: string;
}

export const RESEARCH_CARDS: ResearchCard[] = [
  {
    href: '/dashboard',
    label: 'Market health',
    question: 'Is the broader market confirming this?',
  },
  {
    href: '/sectors',
    label: 'Sector momentum',
    question: 'Where is leadership developing?',
  },
  {
    href: '/strength',
    label: 'Stock strength',
    question: 'Which names are outperforming?',
  },
  {
    href: '/decision',
    label: 'Check a ticker',
    question: 'Positioning, forecast, and strength for any symbol',
  },
  {
    href: '/flow',
    label: 'Options flow',
    question: 'Notable delayed options activity',
  },
  {
    href: '/log',
    label: 'Track record',
    question: 'How have prior daily reads performed?',
  },
  {
    href: '/scanner',
    label: 'Scanner',
    question: "Today's shortlist of candidates",
  },
];
