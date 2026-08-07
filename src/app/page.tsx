import { Dashboard } from '@/components/Dashboard';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { getPositioning } from '@/lib/positioning';

/**
 * Re-render at most twice an hour. The real guard against Polygon's free-plan
 * quota is the cache inside `getPositioning`, but keeping the route from
 * re-rendering on every hit avoids pointless work on Vercel too.
 */
export const revalidate = 1800;

export default async function HomePage() {
  const data = await getPositioning();

  return (
    <>
      <Header
        symbol={data.symbol}
        asOfLabel={data.meta.asOfLabel}
        source={data.meta.source}
      />
      <Dashboard data={data} />
      <Footer />
    </>
  );
}
