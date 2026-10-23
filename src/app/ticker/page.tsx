import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { TickerView } from '@/components/views/TickerView';

export const metadata: Metadata = {
  title: 'Ticker Consensus',
  description:
    'Nine technical signals vote bullish or bearish on any US ticker.',
};

interface PageProps {
  searchParams: Promise<{ symbol?: string }>;
}

/** The page body lives in `TickerView` so `/lab` renders the same component. */
export default async function TickerPage({ searchParams }: PageProps) {
  const { symbol } = await searchParams;
  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <TickerView symbol={symbol} />
      </main>

      <Footer />
    </>
  );
}
