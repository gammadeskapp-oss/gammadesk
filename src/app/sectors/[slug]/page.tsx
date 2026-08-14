import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { TickerLink } from '@/components/TickerLink';
import { formatPrice } from '@/lib/format';
import { getSectorsSnapshot } from '@/lib/sectors';
import { SECTORS, sectorById } from '@/lib/sectors/definitions';
import type { SectorMember, SectorMomentum } from '@/lib/sectors/types';
import { getSymbolDirectory } from '@/lib/symbols/directory';
import { formatAsOf } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** Below this many constituents, one list beats two padded ones. */
const SPLIT_THRESHOLD = 30;
const PER_SIDE = 15;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sector = sectorById(slug);
  return {
    title: sector ? `${sector.name} — Sector` : 'Sector',
    description: sector
      ? `Every ${sector.name} constituent ranked by its nine-signal consensus.`
      : undefined,
  };
}

export function generateStaticParams() {
  return SECTORS.map((s) => ({ slug: s.id }));
}

/**
 * Ranked strongest first.
 *
 * Consensus is an integer out of nine, so ties are the common case rather than
 * the exception — without a second key the order inside a tie would shuffle
 * between runs. Liquidity breaks it, highest first.
 */
function ranked(members: SectorMember[]): SectorMember[] {
  return [...members].sort(
    (a, b) =>
      b.bullish / Math.max(1, b.total) - a.bullish / Math.max(1, a.total) ||
      b.liquidity - a.liquidity ||
      (a.symbol < b.symbol ? -1 : 1),
  );
}

function Badge({ member }: { member: SectorMember }) {
  const share = member.bullish / Math.max(1, member.total);
  const [tone, label] =
    share >= 0.6
      ? ['border-bull/50 text-bull', 'BULLISH']
      : share <= 0.4
        ? ['border-bear/50 text-bear', 'BEARISH']
        : ['border-flip/50 text-flip', 'NEUTRAL'];

  return (
    <span
      className={`whitespace-nowrap border px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] ${tone}`}
    >
      {member.bullish}/{member.total} {label}
    </span>
  );
}

function MemberRow({ member, name }: { member: SectorMember; name?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-term-line/60 px-3.5 py-2.5 text-xs last:border-b-0">
      <span className="w-16 shrink-0 font-bold text-term-text">
        <TickerLink symbol={member.symbol} />
      </span>

      <span className="min-w-0 flex-1 truncate text-2xs text-term-faint">
        {name ?? '—'}
      </span>

      <Badge member={member} />

      <span className="w-20 shrink-0 text-right tabular-nums text-term-dim">
        {formatPrice(member.price)}
      </span>

      <span
        className={`w-16 shrink-0 text-right tabular-nums ${
          member.changePct >= 0 ? 'text-bull' : 'text-bear'
        }`}
      >
        {member.changePct >= 0 ? '+' : ''}
        {(member.changePct * 100).toFixed(2)}%
      </span>
    </li>
  );
}

function List({
  title,
  hint,
  members,
  names,
  tone,
}: {
  title: string;
  hint: string;
  members: SectorMember[];
  names: Map<string, string>;
  tone: 'bull' | 'bear' | 'neutral';
}) {
  const edge =
    tone === 'bull'
      ? 'border-l-bull/60'
      : tone === 'bear'
        ? 'border-l-bear/60'
        : 'border-l-pos/50';

  return (
    <section className={`panel border-l-2 ${edge}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-term-line px-3.5 py-2.5">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          {title}
        </h2>
        <span className="text-2xs text-term-faint">{hint}</span>
      </div>
      <ul>
        {members.map((m) => (
          <MemberRow key={m.symbol} member={m} name={names.get(m.symbol)} />
        ))}
      </ul>
    </section>
  );
}

export default async function SectorDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const definition = sectorById(slug);
  if (!definition) notFound();

  const snapshot = await getSectorsSnapshot();
  const sector: SectorMomentum | undefined = snapshot?.sectors.find(
    (s) => s.id === slug,
  );

  // Company names come from the directory the ticker search already loads, so
  // this costs nothing extra.
  const directory = await getSymbolDirectory().catch(() => null);
  const names = new Map(
    (directory?.entries ?? []).map((e) => [e.s, e.n] as const),
  );

  const members = sector ? ranked(sector.members) : [];
  const split = members.length >= SPLIT_THRESHOLD;

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title={definition.name}
          description={definition.blurb}
          meta={
            sector
              ? `${members.length} constituents · score ${sector.score.toFixed(0)}`
              : undefined
          }
          asOfLabel={
            snapshot ? formatAsOf(new Date(snapshot.computedAt)) : undefined
          }
        />

        <Link
          href="/sectors"
          className="inline-block text-2xs uppercase tracking-[0.14em] text-term-faint transition-colors hover:text-pos"
        >
          ← All sectors
        </Link>

        {!sector || members.length === 0 ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">Nothing computed for this sector yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Sector scores are built once a day and served from storage. This
              fills in on the next scheduled run, or the next request to{' '}
              <Link href="/sectors" className="text-pos underline decoration-dotted">
                the sectors page
              </Link>
              .
            </p>
          </div>
        ) : split ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <List
              title={`Top ${PER_SIDE}`}
              hint="highest consensus"
              members={members.slice(0, PER_SIDE)}
              names={names}
              tone="bull"
            />
            <List
              title={`Bottom ${PER_SIDE}`}
              hint="lowest consensus"
              members={members.slice(-PER_SIDE).reverse()}
              names={names}
              tone="bear"
            />
          </div>
        ) : (
          <List
            title={`All ${members.length}, ranked`}
            hint="strongest first"
            members={members}
            names={names}
            tone="neutral"
          />
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <span className="label-xs">How this is ranked</span>
          <p className="mt-1.5">
            Every name runs through the same nine checks as the{' '}
            <Link href="/ticker" className="text-term-dim underline decoration-dotted">
              ticker page
            </Link>
            , and is ordered by how many of them it passes. Consensus is a whole
            number out of nine, so ties are the normal case rather than the
            exception — they break on share liquidity, most-traded first, which
            keeps the order stable between runs instead of shuffling.
          </p>
          {!split && (
            <p className="mt-2">
              <span className="text-term-dim">One list, not two. </span>
              A sector needs {SPLIT_THRESHOLD} constituents before splitting into
              a top and bottom {PER_SIDE} means anything; this one has{' '}
              {members.length}, so padding it into two lists would show most
              names twice.
            </p>
          )}
          <p className="mt-2">
            Ranking says which names the model currently rates highest. It is
            not a recommendation to buy the top of the list or sell the bottom
            of it.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
