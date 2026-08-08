import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { getDigest, storeStatus } from '@/lib/digest';
import { formatPrice, formatUsd } from '@/lib/format';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Daily Digest',
  description:
    'A fifteen-second plain-English summary of SPY positioning, the forecast lean, and relative strength.',
};

export const dynamic = 'force-dynamic';

function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'bull' | 'bear' | 'flip';
}) {
  const colour = {
    neutral: 'text-term-text',
    pos: 'text-pos',
    neg: 'text-neg',
    bull: 'text-bull',
    bear: 'text-bear',
    flip: 'text-flip',
  }[tone];

  return (
    <div className="border border-term-line px-3 py-1.5">
      <div className="label-xs">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

export default async function DigestPage() {
  const { digest, stored } = await getDigest();
  const store = storeStatus();

  return (
    <>
      <Header symbol={digest.symbol} active="digest" />

      <main className="mx-auto w-full max-w-[900px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            Daily Digest
          </h1>
          <p className="text-2xs text-term-faint">
            {digest.dateLabel} · generated {formatAsOf(new Date(digest.generatedAt))}
            {stored ? '' : ' · live, not yet posted'}
          </p>
        </div>

        <article className="panel border-l-2 border-l-pos/50 p-5">
          <div className="flex flex-wrap gap-2">
            <Chip label="Spot" value={formatPrice(digest.spot)} />
            <Chip
              label="Gamma regime"
              value={digest.regime === 'positive' ? 'POSITIVE' : 'NEGATIVE'}
              tone={digest.regime === 'positive' ? 'pos' : 'neg'}
            />
            <Chip label="Net GEX" value={formatUsd(digest.netGex)} tone={digest.netGex >= 0 ? 'pos' : 'neg'} />
            <Chip
              label="Gamma flip"
              value={digest.flipLevel === null ? '—' : formatPrice(digest.flipLevel)}
              tone="flip"
            />
            {digest.odds3d !== null && (
              <Chip
                label="3D higher"
                value={`${digest.odds3d.toFixed(0)}%`}
                tone={digest.odds3d >= 50 ? 'bull' : 'bear'}
              />
            )}
            {digest.odds10d !== null && (
              <Chip
                label="10D higher"
                value={`${digest.odds10d.toFixed(0)}%`}
                tone={digest.odds10d >= 50 ? 'bull' : 'bear'}
              />
            )}
            {digest.riskLabel && (
              <Chip
                label="Downturn"
                value={digest.riskLabel}
                tone={
                  digest.riskLabel === 'CALM'
                    ? 'bull'
                    : digest.riskLabel === 'CAUTIOUS'
                      ? 'flip'
                      : 'bear'
                }
              />
            )}
          </div>

          <div className="mt-4 space-y-2.5 border-t border-term-line pt-4 text-sm leading-relaxed text-term-text">
            {digest.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          {(digest.leaders.length > 0 || digest.laggards.length > 0) && (
            <div className="mt-4 grid gap-3 border-t border-term-line pt-3 sm:grid-cols-2">
              <div>
                <div className="label-xs text-bull">Leaders</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                  {digest.leaders.map((l) => (
                    <span key={l.symbol}>
                      <span className="font-bold text-term-text">{l.symbol}</span>{' '}
                      <span className="text-bull">{l.score}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="label-xs text-bear">Laggards</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                  {digest.laggards.map((l) => (
                    <span key={l.symbol}>
                      <span className="font-bold text-term-text">{l.symbol}</span>{' '}
                      <span className="text-bear">{l.score}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {digest.notes.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-term-line pt-3 text-2xs text-flip/80">
              {digest.notes.map((n) => (
                <li key={n}>! {n}</li>
              ))}
            </ul>
          )}
        </article>

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">What this is. </span>
            A summary of what the rest of the site already shows — the{' '}
            <Link href="/" className="text-term-dim underline decoration-dotted">
              positioning
            </Link>{' '}
            table, the{' '}
            <Link href="/forecast" className="text-term-dim underline decoration-dotted">
              simulation
            </Link>{' '}
            and the{' '}
            <Link href="/strength" className="text-term-dim underline decoration-dotted">
              strength ranking
            </Link>
            . It adds no new information and no judgement of its own.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Everything here is modelled. </span>
            The odds come from a simulation that holds volatility constant and
            assumes log-normal returns, so they understate the tails. The gamma
            regime rests on an assumption about who is on the other side of each
            option trade. None of it accounts for earnings, data or news.
          </p>
          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
