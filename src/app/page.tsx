import { Footer } from '@/components/Footer';
import { HomeRedesign } from '@/components/redesign/HomeRedesign';
import { loadHomeData } from '@/lib/redesign/data';

/**
 * The integrated Home Dashboard (Home + the old /dashboard, merged).
 *
 * Rendered per request, like the old dashboard: every figure comes from the
 * real server-side loader, which reads the same cached snapshots the specialist
 * pages use (positioning, forecast, groups, sectors, flow, net liquidity,
 * breadth, quotes, macro bias). Each source is allowed to fail on its own, so
 * one dead feed costs its module, not the page — see `lib/redesign/data`.
 *
 * The previous data-fetching front door is preserved in `src/app/_legacyHome.tsx`.
 *
 * `/dashboard` is intentionally NOT redirected here yet: the spec gates that on
 * the merged Home being reviewed with real data.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const data = await loadHomeData();
  return (
    <>
      <HomeRedesign data={data} />
      <Footer />
    </>
  );
}
