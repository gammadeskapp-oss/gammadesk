import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { CrashCard } from '@/components/CrashCard';
import { GroupCard } from '@/components/GroupCard';
import { MarketInternalsStrip } from '@/components/MarketInternals';
import { getForecast } from '@/lib/forecast';
import type { ForecastResult } from '@/lib/forecast/types';
import { getGroupsSnapshot } from '@/lib/groups';
import type { GroupsSnapshot } from '@/lib/groups/types';
import { InfoTip } from '@/components/InfoTip';
import { PageBar } from '@/components/PageBar';
import { Sparkline } from '@/components/Sparkline';
import {
  getSectorsSnapshot,
  SECTOR_THRESHOLDS,
  splitByMomentum,
  storeStatus,
  type SectorMomentum,
} from '@/lib/sectors';
import type { SectorConsensus } from '@/lib/sectors/types';
import { formatAsOf } from '@/lib/time';
import type { TooltipKey } from '@/lib/tooltips';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Sector Momentum',
  description:
    'Which sectors are getting stronger and which are fading, measured by the change in their nine-signal score.',
};

export const dynamic = 'force-dynamic';

/**
 * Which view the page is showing.
 *
 * Driven by the URL rather than client state, so the permanent redirect from
 * the old /groups route can land straight on the groups view, and so either
 * side can be linked and bookmarked.
 */
type View = 'sectors' | 'groups';

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

function ViewToggle({ view }: { view: View }) {
  const tab = (target: View, label: string, hint: string) => {
    const active = view === target;
    return (
      <Link
        key={target}
        href={target === 'sectors' ? '/sectors' : '/sectors?view=groups'}
        aria-current={active ? 'page' : undefined}
        title={hint}
        className={`border px-4 py-2 text-2xs font-bold uppercase tracking-[0.14em] transition-colors ${
          active
            ? 'border-pos/60 bg-pos/15 text-pos'
            : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div role="group" aria-label="View" className="flex flex-wrap items-center gap-1">
      {tab('sectors', 'Sectors', 'The eleven market sectors, by how their score is changing')}
      {tab('groups', 'Groups', 'Themed baskets — megacap tech, chips, the index ETFs')}
    </div>
  );
}

/** Weighted nine-signal badge, in the same shape the ticker page uses. */
function ConsensusBadge({ consensus }: { consensus: SectorConsensus }) {
  const tone =
    consensus.label === 'BULLISH'
      ? 'border-bull/50 text-bull'
      : consensus.label === 'BEARISH'
        ? 'border-bear/50 text-bear'
        : 'border-flip/50 text-flip';

  return (
    <span
      className={`whitespace-nowrap border px-2 py-0.5 text-2xs font-bold tracking-[0.1em] ${tone}`}
      title={
        consensus.basis === 'market-cap'
          ? 'Nine-signal consensus, market-cap weighted across the sector.'
          : `Nine-signal consensus, equal-weighted — no cap data for ${consensus.missingCaps.join(', ')}.`
      }
    >
      {consensus.bullish}/{consensus.total} {consensus.label}
      {consensus.basis === 'equal' && (
        <span className="ml-1 font-normal text-term-faint">· eq</span>
      )}
    </span>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-term-faint">—</span>;
  // `|| 0` kills negative zero: averages of ninths land on -1.8e-15, which
  // would otherwise render as a very confident-looking "-0.0".
  const rounded = Math.round(value * 10) / 10 || 0;
  const tone =
    rounded > 0 ? 'text-bull' : rounded < 0 ? 'text-bear' : 'text-term-faint';
  return (
    <span className={`tabular-nums ${tone}`}>
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(1)}
    </span>
  );
}

const FLAG: Record<
  NonNullable<SectorMomentum['flag']>,
  { text: string; classes: string; tip: TooltipKey }
> = {
  bottoming: {
    text: 'Bottoming + turning',
    classes: 'border-bull/50 bg-bull/10 text-bull',
    tip: 'sectorBottoming',
  },
  topping: {
    text: 'Topping + rolling over',
    classes: 'border-bear/50 bg-bear/10 text-bear',
    tip: 'sectorTopping',
  },
};

function SectorRow({ sector, rising }: { sector: SectorMomentum; rising: boolean }) {
  const flag = sector.flag ? FLAG[sector.flag] : null;

  return (
    <li className="border-b border-term-line/60 px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-bold text-term-text">{sector.name}</span>
            <ConsensusBadge consensus={sector.consensus} />
            <span className="text-2xs tabular-nums text-term-faint">
              score {sector.score.toFixed(0)}
            </span>
          </div>
          <p className="mt-0.5 text-2xs text-term-faint">{sector.blurb}</p>
        </div>

        <Sparkline
          values={sector.series.map((p) => p.score)}
          rising={rising}
          label={`${sector.name} score over the last ${sector.series.length} sessions, ${
            rising ? 'rising' : 'falling'
          }.`}
        />

        {/* Δ5D is the sort key, so it is the one given weight. */}
        <dl className="flex shrink-0 items-center gap-x-3 text-xs">
          {(
            [
              ['1D', sector.delta1, false],
              ['3D', sector.delta3, false],
              ['5D', sector.delta5, true],
            ] as const
          ).map(([label, value, primary]) => (
            <div key={label} className="text-right">
              <dt
                className={`text-2xs uppercase tracking-[0.1em] ${
                  primary ? 'text-term-dim' : 'text-term-faint'
                }`}
              >
                Δ{label}
              </dt>
              <dd className={primary ? 'font-bold' : ''}>
                <Delta value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {flag && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={`border px-2 py-0.5 text-2xs font-bold tracking-[0.1em] ${flag.classes}`}
          >
            {flag.text}
          </span>
          <InfoTip for={flag.tip} />
        </div>
      )}

      {sector.failures.length > 0 && (
        <p className="mt-1.5 text-2xs text-flip/70">
          ! {sector.failures.join(', ')} had no usable history and are excluded.
        </p>
      )}
    </li>
  );
}

function Side({
  title,
  headline,
  tip,
  tone,
  sectors,
  rising,
  empty,
}: {
  title: string;
  headline: string;
  tip: TooltipKey;
  tone: 'bull' | 'bear';
  sectors: SectorMomentum[];
  rising: boolean;
  empty: string;
}) {
  return (
    <section className="panel">
      <div
        className={`border-b border-term-line px-3.5 py-3 ${
          tone === 'bull' ? 'border-l-2 border-l-bull/60' : 'border-l-2 border-l-bear/60'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <h2
            className={`text-2xs font-bold uppercase tracking-[0.18em] ${
              tone === 'bull' ? 'text-bull' : 'text-bear'
            }`}
          >
            {title}
          </h2>
          <InfoTip for={tip} />
        </div>
        <p className="mt-1 text-sm leading-relaxed text-term-text">{headline}</p>
      </div>

      {sectors.length === 0 ? (
        <p className="px-3.5 py-8 text-center text-xs text-term-dim">{empty}</p>
      ) : (
        <ul>
          {sectors.map((s) => (
            <SectorRow key={s.id} sector={s} rising={rising} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The old /groups page, living here as a view.
 *
 * Ported whole — group cards, the breadth strip and the downturn card — so the
 * merge does not quietly drop anything that page did.
 */
function GroupsView({
  snapshot,
  forecast,
}: {
  snapshot: GroupsSnapshot | null;
  forecast: ForecastResult | null;
}) {
  if (!snapshot) {
    return (
      <div className="panel px-4 py-10 text-center text-xs text-term-dim">
        <p className="text-term-text">No group snapshot yet.</p>
        <p className="mx-auto mt-2 max-w-xl leading-relaxed">
          Scores are computed once a day and served from storage rather than
          recalculated per visit. The first run happens on the next scheduled
          refresh, or on the next request to this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {forecast && <CrashCard forecast={forecast} />}

      <MarketInternalsStrip internals={snapshot.internals} />

      <section aria-label="Group consensus" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
            Model consensus
          </h2>
          <p className="text-2xs text-term-faint">
            click a group to see each ticker&rsquo;s own score
          </p>
        </div>

        <div className="space-y-2">
          {snapshot.groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      </section>

      <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
        <span className="label-xs">Groups are themes, not sectors</span>
        <p className="mt-1.5">
          These baskets overlap on purpose — NVDA sits in both MAG7 and SEMI —
          which is why they are kept apart from the{' '}
          <Link href="/sectors" className="text-term-dim underline decoration-dotted">
            sector view
          </Link>
          , where membership is disjoint so the averages can be compared against
          each other. Every ticker runs through the same nine-signal engine as{' '}
          <Link href="/ticker" className="text-term-dim underline decoration-dotted">
            the ticker page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

export default async function SectorsPage({ searchParams }: PageProps) {
  const { view: rawView } = await searchParams;
  const view: View = rawView === 'groups' ? 'groups' : 'sectors';

  const [snapshot, groups, forecast] = await Promise.all([
    getSectorsSnapshot(),
    // Only paid for when the groups view is actually being shown.
    view === 'groups' ? getGroupsSnapshot() : Promise.resolve(null),
    view === 'groups' ? getForecast().catch(() => null) : Promise.resolve(null),
  ]);

  const store = storeStatus();
  const split = snapshot ? splitByMomentum(snapshot) : null;

  const equalWeighted = (snapshot?.sectors ?? []).filter(
    (s) => s.consensus.basis === 'equal',
  );

  return (
    <>
      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title={view === 'groups' ? 'Groups' : 'Sector Momentum'}
          description={PAGE_DESCRIPTIONS['/sectors']}
          meta={
            view === 'groups'
              ? groups
                ? `${groups.groups.length} groups · ${groups.internals.universe} names · close ${groups.asOfDate}`
                : undefined
              : snapshot
                ? `${snapshot.sectors.length} sectors · ${snapshot.sessions} sessions · close ${snapshot.asOfDate}`
                : undefined
          }
          asOfLabel={
            view === 'groups'
              ? groups
                ? formatAsOf(new Date(groups.computedAt))
                : undefined
              : snapshot
                ? formatAsOf(new Date(snapshot.computedAt))
                : undefined
          }
        />

        <ViewToggle view={view} />

        {view === 'groups' ? (
          <GroupsView snapshot={groups} forecast={forecast} />
        ) : (
        <>
        <section className="panel border-l-2 border-l-pos/50 px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-term-text">
            <span className="font-bold text-pos">This tracks change, not level. </span>
            A sector can be the healthiest on the board and still be fading, or
            the weakest and still be turning up. The columns show how the score
            moved over 1, 3 and 5 trading days.
          </p>
          <p className="mt-2 text-term-dim">
            &ldquo;Rotating in&rdquo; is a description of what has already
            happened, not a prediction of what happens next. Money moving into a
            sector for a week is exactly as consistent with the move being over
            as with it continuing.
          </p>
        </section>

        {!snapshot || !split ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No sector snapshot yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Scores are computed once a day and served from storage. The first
              run happens on the next scheduled refresh, or on the next request
              to this page.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 xl:grid-cols-2">
              <Side
                title="Accelerating"
                headline="Strength rising fastest — where money may be rotating IN."
                tip="sectorAccelerating"
                tone="bull"
                sectors={split.accelerating}
                rising
                empty="No sector is stronger than it was five sessions ago."
              />
              <Side
                title="Decelerating"
                headline="Strength fading fastest — where money may be rotating OUT."
                tip="sectorDecelerating"
                tone="bear"
                sectors={split.decelerating}
                rising={false}
                empty="No sector is weaker than it was five sessions ago."
              />
            </div>

            {split.flat.length > 0 && (
              <section className="panel px-3.5 py-3">
                <h2 className="label-xs">Unchanged over five sessions</h2>
                <p className="mt-1.5 text-xs text-term-dim">
                  {split.flat.map((s) => s.name).join(', ')} — no five-day move
                  to rank, so neither side claims them.
                </p>
              </section>
            )}
          </>
        )}

        {/* Never silently mixed: a sector missing one cap falls back whole. */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <span className="label-xs">Consensus weighting</span>
          <p className="mt-1.5">
            {equalWeighted.length === 0 ? (
              <>
                Every sector&rsquo;s consensus is{' '}
                <span className="text-term-dim">market-cap weighted</span>, so a
                small member cannot swing it. Caps come from Polygon and are
                refreshed with the rest of the nightly run.
              </>
            ) : (
              <>
                <span className="text-flip">
                  {equalWeighted.map((s) => s.name).join(', ')} —
                  equal-weighted, cap data unavailable.
                </span>{' '}
                Every other sector is market-cap weighted. A sector missing even
                one member&rsquo;s cap falls back entirely rather than blending
                the two, because a half-weighted average would not be comparable
                with the sector beside it while looking exactly like it.
              </>
            )}
          </p>
        </section>
        </>
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="flex items-center gap-1.5">
            <span className="label-xs">How this is built</span>
            <InfoTip for="sectorScore" />
            <InfoTip for="sectorDelta" />
            <InfoTip for="sectorSpark" />
          </h2>
          <p className="mt-1.5">
            Each sector&rsquo;s score is the share of the nine{' '}
            <Link href="/ticker" className="text-term-dim underline decoration-dotted">
              ticker signals
            </Link>{' '}
            voting bullish, averaged across its members. Sectors are disjoint —
            no symbol sits in two — so the averages can be compared against each
            other. Both sides are sorted on the five-session change, the widest
            window shown; the one-day number flips too often to rank anything.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">The history is derived, not accumulated. </span>
            The signals are a pure function of the price history, so the score
            as of five sessions ago is simply the score recomputed on the bars
            up to that day. That is why the page was complete from its first run
            rather than blank for a week, and why a missed day repairs itself on
            the next.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">On the two flags. </span>
            Both need a stretch and a turn, never just a stretch. Bottoming
            means average RSI fell to {SECTOR_THRESHOLDS.OVERSOLD} or below in
            the last {SECTOR_THRESHOLDS.SESSIONS} sessions and the three-day
            change has turned positive; topping is the mirror at{' '}
            {SECTOR_THRESHOLDS.OVERBOUGHT}. Those thresholds are pulled in from
            the usual 30 and 70 because an average of five RSIs rarely reaches
            the extremes a single stock does. Plenty of these turns fail — the
            flag is a reason to look, not a reason to act.
          </p>
          <p className="mt-2">
            Prices are end-of-day and delayed, and nothing here is a
            recommendation to buy or sell anything.
          </p>
          {snapshot?.notes.map((n) => (
            <p key={n} className="mt-2 text-flip/80">! {n}</p>
          ))}
          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
