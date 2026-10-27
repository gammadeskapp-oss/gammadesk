import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { DecisionView } from '@/components/views/DecisionView';

export const metadata: Metadata = {
  title: 'Decision',
  description:
    'Context, levels, a conviction check, a chart or forecast, and the exposure tables for one ticker, on one screen.',
};

export const dynamic = 'force-dynamic';
// A cold render fetches and parses the full option chain (~6 MB) and resolves the
// IV surface, which can run well past the platform's 60s default on a cold
// instance. 300s (the Pro-plan ceiling) keeps the page from being killed
// mid-render while the snapshot cache (see /api/x/snapshot) removes the cost.
export const maxDuration = 300;

interface PageProps {
  /**
   * `ticker` is the scheme `<TickerLink>` uses. `symbol` is still accepted so
   * links shared before the rename keep working.
   */
  searchParams: Promise<{ ticker?: string; symbol?: string }>;
}

/** The page body lives in `DecisionView` so `/lab` renders the same component. */
export default async function DecisionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <>
      <DecisionView ticker={params.ticker ?? params.symbol} />

      <Footer />
    </>
  );
}
