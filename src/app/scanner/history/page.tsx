import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { ScannerRunRate } from '@/components/ScannerRunRate';
import { TickerLink } from '@/components/TickerLink';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import {
  ARCHIVE_KEEP_DAYS,
  averagePerDay,
  dailyCounts,
  readArchive,
  storeStatus,
} from '@/lib/scanner';
import {
  RULE_LABEL,
  OPTION_BADGE_LABEL,
  type FilterState,
  type OptionQualityBadge,
} from '@/lib/scanner/types';
import { contractSummary } from '@/lib/scanner/optionQuality';

export const metadata: Metadata = {
  title: 'Scanner History',
  description:
    'Every past morning the scanner ran, with the names it produced and the option numbers as they stood that day.',
};

export const dynamic = 'force-dynamic';

/**
 * Label one archived badge key.
 *
 * The archive spans a rule-set change. Mornings recorded before the scanner
 * was rebuilt carry the four old alignment keys; everything since carries the
 * five rule keys. Both are labelled here rather than one of them being
 * discarded, because an archive that silently drops the days it no longer
 * understands is not an archive — and the whole point of keeping ninety days
 * is to be able to look back across exactly this kind of change.
 */
const LEGACY_BADGE_LABEL: Record<string, string> = {
  market: 'Market aligned',
  momentum: 'Momentum confirmed',
  trend: 'Trend aligned',
  options: 'Options liquid',
};

function badgeLabel(key: string): string {
  return (
    RULE_LABEL[key as keyof typeof RULE_LABEL] ??
    LEGACY_BADGE_LABEL[key] ??
    key
  );
}

const STATE_CLASS: Record<FilterState, string> = {
  pass: 'border-bull/50 bg-bull/15 text-bull',
  fail: 'border-bear/50 bg-bear/10 text-bear',
  unknown: 'border-term-line bg-term-raised text-term-faint',
};

const BADGE_CLASS: Record<OptionQualityBadge, string> = {
  excellent: 'border-bull/60 bg-bull/15 text-bull',
  tradable: 'border-pos/60 bg-pos/12 text-pos',
  caution: 'border-flip/60 bg-flip/12 text-flip',
  avoid: 'border-bear/60 bg-bear/12 text-bear',
  unknown: 'border-term-line bg-term-raised text-term-faint',
};

/**
 * Every archived morning.
 *
 * ## Nothing here is recomputed
 *
 * The scores, the badges and the option numbers are read back exactly as they
 * were stored on the day. Regrading a contract against today's chain would
 * answer a different question — what does this look like now — and quietly
 * rewrite the record of what the scan was actually looking at when it put the
 * name on the list. An archive that updates itself is not an archive.
 *
 * This page therefore makes no upstream requests at all. It is one stored read.
 */
export default async function ScannerHistoryPage() {
  const days = await readArchive().catch(() => []);
  const store = storeStatus();

  const counts = dailyCounts(days);
  const average = averagePerDay(days);

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Scanner History"
          description={PAGE_DESCRIPTIONS['/scanner/history']}
          meta={
            days.length > 0
              ? `${days.length} morning${days.length === 1 ? '' : 's'} kept`
              : 'nothing archived yet'
          }
        />

        <p className="text-xs text-term-dim">
          <Link href="/scanner" className="underline decoration-dotted">
            ← Today&rsquo;s scan
          </Link>
        </p>

        <ScannerRunRate counts={counts} average={average} days={14} />

        {days.length === 0 ? (
          <div className="panel px-4 py-10 text-center text-xs">
            <p className="font-bold text-term-text">Nothing archived yet.</p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
              Each morning&rsquo;s result is recorded here after the scan runs,
              and the last {ARCHIVE_KEEP_DAYS} are kept. Mornings that produce
              no names are recorded too — a zero is a result, and leaving it out
              would make the run rate above describe a rule set nobody is using.
            </p>
            {!store.durable && store.note && (
              <p className="mt-3 text-2xs text-flip/80">! {store.note}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {days.map((day) => (
              <section key={day.date} className="panel">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-term-line px-3.5 py-2.5">
                  <h2 className="text-sm font-bold tracking-[0.08em] text-term-text">
                    {day.date}
                  </h2>
                  <p className="text-2xs text-term-dim">
                    <span className="font-bold text-term-text">
                      {day.passed} passed
                    </span>{' '}
                    · {day.candidates} cleared RS {day.rsMin} of {day.universe} ·{' '}
                    {day.earningsExcluded} removed for earnings ·{' '}
                    {day.qualityChecked} contracts graded at scan time
                  </p>
                </div>

                {day.gateReason ? (
                  <p className="px-3.5 py-4 text-xs leading-relaxed text-bear">
                    {day.gateReason}
                  </p>
                ) : day.names.length === 0 ? (
                  <p className="px-3.5 py-4 text-xs leading-relaxed text-term-dim">
                    No names matched every default filter this morning. The market
                    gate was open, so this is the rules doing their work rather
                    than the market shutting the scan.
                  </p>
                ) : (
                  <ul className="divide-y divide-term-line/60">
                    {day.names.map((name) => (
                      <li key={name.symbol} className="space-y-1.5 px-3.5 py-3">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-sm font-bold text-term-text">
                            <TickerLink symbol={name.symbol} />
                          </span>
                          <span className="text-xs tabular-nums text-term-dim">
                            {name.score.toFixed(0)}/100
                          </span>
                          {name.optionBadge && (
                            <span
                              className={`inline-flex items-center border px-1.5 py-0.5 text-2xs font-bold uppercase tracking-[0.1em] ${BADGE_CLASS[name.optionBadge]}`}
                            >
                              {OPTION_BADGE_LABEL[name.optionBadge]}
                            </span>
                          )}
                          <span className="text-2xs tabular-nums text-term-faint">
                            {contractSummary(name.contract)}
                          </span>
                        </div>

                        <ul className="flex flex-wrap gap-1">
                          {name.badges.map((badge) => (
                            <li
                              key={badge.key}
                              className={`inline-flex items-center border px-1.5 py-0.5 text-2xs tracking-[0.06em] ${STATE_CLASS[badge.state]}`}
                            >
                              {badgeLabel(badge.key)}
                              <span className="sr-only"> {badge.state}</span>
                            </li>
                          ))}
                        </ul>

                        {/* Kept verbatim from the day, not rebuilt. */}
                        <p className="text-2xs leading-relaxed text-flip/90">
                          <span className="font-bold">Watch: </span>
                          {name.watch}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">About this record</h2>
          <p className="mt-1.5">
            Everything above is read back exactly as it was stored on the
            morning it ran. The option numbers are a snapshot of the chain the
            scan was looking at, not a live read — regrading them against
            today&rsquo;s chain would answer what the contract looks like now,
            which is a different question and would rewrite the record of the
            decision.
          </p>
          <p className="mt-2">
            The last {ARCHIVE_KEEP_DAYS} mornings are kept. Zero-name mornings
            are recorded alongside the rest, because a run rate that skipped its
            zeros would describe a rule set nobody is running.
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
