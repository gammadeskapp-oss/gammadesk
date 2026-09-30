import { Footer } from '@/components/Footer';
import { HomeRedesign } from '@/components/redesign/HomeRedesign';

/**
 * The integrated Home Dashboard (Home + the old /dashboard, merged).
 *
 * ⚠️  Layout-first preview: this renders the new structure with placeholder
 * data from `lib/redesign/mock`. The real-data wiring (positioning, forecast,
 * groups, flow, net liquidity, breadth, quotes, macro bias) is restored in a
 * follow-up commit — the previous data-fetching implementation is preserved in
 * `src/app/_legacyHome.tsx` for that phase.
 *
 * `/dashboard` is intentionally NOT redirected here yet: the spec gates that on
 * the merged Home being built and tested with real data.
 */
export default function HomePage() {
  return (
    <>
      <HomeRedesign />
      <Footer />
    </>
  );
}
