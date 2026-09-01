import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { readCronHealth, type CronSource } from '@/lib/cronHealth';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { config } from '@/lib/config';
import { lastGoodSnapshotStatus } from '@/lib/lastSnapshot';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Status',
  description: PAGE_DESCRIPTIONS['/status'],
};

/**
 * Never cached. A status page served from a cache can report a job as healthy
 * minutes after it stopped being so, which is the one failure this page exists
 * to make impossible.
 */
export const dynamic = 'force-dynamic';

/*
 * Green or red, with nothing in between. Late and never-run are both red on
 * purpose — the word beside the dot says which, and an amber middle state
 * would invite reading "behind" as "nearly fine".
 */
function Dot({ state }: { state: CronSource['state'] }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        state === 'ok' ? 'bg-pos' : 'bg-bear'
      }`}
    />
  );
}

function stateWord(source: CronSource): string {
  if (source.state === 'ok') return 'OK';
  return source.state === 'late' ? 'LATE' : 'NEVER RAN';
}

function Row({ source }: { source: CronSource }) {
  const ok = source.state === 'ok';

  return (
    <div className="grid gap-x-4 gap-y-1 border-b border-term-line px-3.5 py-3 last:border-b-0 sm:grid-cols-[1.6fr_1fr_auto] sm:items-baseline">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Dot state={source.state} />
          <span className="truncate text-xs font-bold text-term-text">
            {source.label}
          </span>
        </div>
        <p className="mt-0.5 pl-4 font-mono text-2xs text-term-faint">
          {source.path}
        </p>
        <p className="mt-0.5 pl-4 text-2xs text-term-faint">{source.schedule}</p>
      </div>

      <div className="pl-4 sm:pl-0">
        <div className="label-xs">Last success</div>
        <div className="text-xs tabular-nums text-term-dim">
          {source.lastSuccess
            ? formatAsOf(new Date(source.lastSuccess))
            : 'never'}
        </div>
        {source.ageHours !== null && (
          <div className="text-2xs tabular-nums text-term-faint">
            {source.ageHours.toFixed(1)}h ago · late past{' '}
            {source.staleAfterHours}h
          </div>
        )}
        {source.detail && (
          <div className="mt-0.5 text-2xs leading-relaxed text-term-faint">
            {source.detail}
          </div>
        )}
      </div>

      <div className="pl-4 sm:pl-0 sm:text-right">
        <span
          className={`text-2xs font-bold uppercase tracking-[0.14em] ${
            ok ? 'text-pos' : 'text-bear'
          }`}
        >
          {stateWord(source)}
        </span>
      </div>
    </div>
  );
}

export default async function StatusPage() {
  const health = await readCronHealth();

  /*
   * The live chain feed, which is not a cron and therefore not in `health`.
   *
   * It is here because the error screen a visitor hits when the feed is down
   * points at this page, and it would be a poor destination if it could only
   * talk about scheduled jobs. Presence only — never a credential value.
   */
  const feed = await lastGoodSnapshotStatus().catch(() => ({
    present: false,
    quoteDate: null,
    savedAt: null,
  }));
  const credentialPresent =
    config.dataSource === 'polygon' ? Boolean(config.apiKey) : true;

  /*
   * Read here rather than from a movers result, so the row is truthful even
   * when the page has never been built this process.
   */
  const moversLive = Boolean(process.env.TRADIER_TOKEN?.trim());
  const allGood = health.problemCount === 0;

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Status"
          description={PAGE_DESCRIPTIONS['/status']}
          asOfLabel={formatAsOf(new Date(health.checkedAt))}
        />

        <div
          className={`panel border-l-2 px-4 py-3 ${
            allGood ? 'border-l-pos/60' : 'border-l-bear'
          }`}
        >
          <p
            className={`text-sm font-bold ${allGood ? 'text-pos' : 'text-bear'}`}
          >
            {allGood
              ? 'Every scheduled job has written recently.'
              : health.problemCount === 1
                ? `1 of ${health.sources.length} jobs is behind or has never run.`
                : `${health.problemCount} of ${health.sources.length} jobs are behind or have never run.`}
          </p>
          <p className="mt-1.5 text-2xs leading-relaxed text-term-dim">
            Green means the job wrote something inside its own window, not that
            what it wrote was correct. A job can succeed and still store a bad
            number; this page cannot tell you about that, only about silence.
          </p>
        </div>

        <section className="panel" aria-label="Scheduled jobs">
          {health.sources.map((source) => (
            <Row key={`${source.path}-${source.label}`} source={source} />
          ))}
        </section>

        {/*
          The live feed. Separate from the job list above because it is not a
          job — nothing schedules it, every page load reads it directly — and
          because this is where the visitor-facing error card sends people.
        */}
        <section className="panel px-3.5 py-3" aria-label="Market data feed">
          <h2 className="label-xs">Market data feed</h2>

          <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-2xs sm:grid-cols-3">
            <div>
              <dt className="text-term-faint">Provider</dt>
              <dd className="text-term-text">{config.dataSource}</dd>
            </div>
            <div>
              <dt className="text-term-faint">Movers source</dt>
              {/*
                Named here because the two readings are not interchangeable and
                only one of them may ever be served publicly. "live" appearing
                on a deployed status page means a Tradier token has reached an
                environment it must never be in — see `MoversSource`.
              */}
              <dd className={moversLive ? 'text-bear' : 'text-term-text'}>
                {moversLive
                  ? 'live intraday (Tradier) — local only, must not be deployed'
                  : 'last completed session (Polygon)'}
              </dd>
            </div>
            <div>
              <dt className="text-term-faint">Credential</dt>
              <dd className={credentialPresent ? 'text-pos' : 'text-bear'}>
                {credentialPresent
                  ? 'present'
                  : 'missing — the feed cannot be read'}
              </dd>
            </div>
            <div>
              <dt className="text-term-faint">Last good snapshot</dt>
              <dd className={feed.present ? 'text-term-text' : 'text-bear'}>
                {feed.quoteDate
                  ? formatAsOf(new Date(feed.quoteDate))
                  : 'none stored'}
              </dd>
            </div>
          </dl>

          <p className="mt-2.5 text-2xs leading-relaxed text-term-faint">
            {feed.present ? (
              <>
                When the live feed cannot be reached, pages serve this stored
                snapshot with a warning banner above it rather than failing.
                Recovered data is never presented as current — it keeps its own
                timestamp, and the banner is not dismissible.
              </>
            ) : (
              <>
                Nothing is stored yet, so a feed outage right now would leave
                pages with nothing to show. The first successful read writes
                this, after which an outage degrades to stale data instead of an
                error.
              </>
            )}
          </p>

          <p className="mt-2 text-2xs leading-relaxed text-term-faint">
            Which credentials this deployment can actually see is reported by{' '}
            <a href="/api/health" className="underline hover:text-term-text">
              /api/health
            </a>
            , as presence only — no value is ever returned or displayed.
          </p>
        </section>

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">Reading the limits. </span>
            Most of these run on weekdays only, so the &ldquo;late past&rdquo;
            figure is set wide enough to cover a long weekend. That means a job
            which died on Monday will not show red until Thursday. The tradeoff
            is deliberate: a page that turns red every Saturday is a page that
            gets ignored by the following Tuesday.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">The machine-readable version. </span>
            <a href="/api/health" className="underline hover:text-term-text">
              /api/health
            </a>{' '}
            returns the same readings as JSON, alongside the storage and
            environment checks. Both are built from one helper, so they cannot
            disagree.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
