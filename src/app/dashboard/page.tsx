import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { DashboardView } from '@/components/views/DashboardView';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Everything GammaDesk knows about the market right now, on one screen.',
};

export const dynamic = 'force-dynamic';

/** The page body lives in `DashboardView` so `/lab` renders the same component. */
export default function DashboardPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <DashboardView />
      </main>

      <Footer />
    </>
  );
}
