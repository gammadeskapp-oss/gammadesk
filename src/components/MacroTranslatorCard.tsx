import { MethodologyDrawer } from './MethodologyDrawer';
import type { EconEvent } from '@/lib/macro/translate';
import {
  aggregateOvernight,
  releaseReadout,
  signedPct,
  type OvernightRow,
} from '@/lib/macro/translate';
import type { ConsensusGap } from '@/lib/macro/consensus';
import type { OvernightData } from '@/lib/macro/overnight';
import { formatAsOf } from '@/lib/time';

/**
 * The overnight & macro translator, in the context section beside breadth and
 * event risk.
 *
 * ## What it says, and what it will not
 *
 * Three plain-English readings: the most recent high-impact release translated
 * into eased-or-tightened, the overnight global tape row by row, and the next
 * scheduled release with a countdown. It is a translator — it never names a
 * direction and never advises an action. The wording is produced entirely by
 * the pure functions in `lib/macro/translate.ts`, which `verify:macro` walks to
 * prove exactly that.
 *
 * ## Server component on purpose
 *
 * It reads the clock (the countdown, the "as of" stamp) and does its reasoning
 * on the server, then hands finished strings down. The methodology drawer is
 * the shared `<details>` one, so the "how this is read" panel is present whether
 * or not the bundle arrives — the reader most likely to open it is the one
 * checking whether to believe the card.
 *
 * ## The stale guard
 *
 * When the overnight quotes are older than the guard threshold the numbers are
 * withheld and the existing stale banner takes their place, rather than rows of
 * confident figures drawn from a dead feed. The aggregate is told it is stale
 * too, so its verdict is mixed regardless of what the last quotes leaned.
 */

/** How old the overnight quotes may be before the numbers are withheld. */
const STALE_MINUTES = 90;

function countdown(releaseAt: string, now: Date): string {
  const ms = Date.parse(releaseAt) - now.getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

const AGG_TONE = {
  'risk-on': 'text-bull',
  'risk-off': 'text-bear',
  mixed: 'text-term-dim',
} as const;

export function MacroTranslatorCard({
  mostRecent,
  next,
  gaps = [],
  overnight,
  now = new Date(),
}: {
  mostRecent: EconEvent | null;
  next: EconEvent | null;
  /** Due-or-overdue releases whose consensus was never entered — shown as gaps. */
  gaps?: ConsensusGap[];
  overnight: OvernightData | null;
  now?: Date;
}) {
  // Nothing to say and nothing to show. An empty shell would imply the readings
  // were taken and came back unremarkable.
  if (!mostRecent && !next && gaps.length === 0 && !overnight) return null;

  /*
   * Two ways the overnight rows are withheld and the aggregate forced to mixed.
   * Age is the stale guard the feature asks for. A total outage — the fetch
   * returned but resolved no quotes at all — is treated the same way rather than
   * shown as "quiet": zero rows leaning nowhere is what a dead feed and a calm
   * night both look like to the aggregate, and only one of them is honest.
   */
  const outage = !overnight || overnight.quotes.length === 0;
  const aged =
    !overnight ||
    now.getTime() - Date.parse(overnight.at) > STALE_MINUTES * 60_000;
  const stale = outage || aged;

  const leanRows: OvernightRow[] = overnight?.leanRows ?? [];
  const verdict = aggregateOvernight(leanRows, { stale });

  // The release reading with the market's response folded into one sentence.
  // SPY's overnight change is the tape the mechanical reading is checked
  // against; withheld when the feed is stale so a dead quote is not read as calm.
  const spy = overnight?.quotes.find((q) => q.key === 'SPY') ?? null;
  const release = mostRecent
    ? releaseReadout(mostRecent, stale ? null : (spy?.changePct ?? null))
    : null;

  const methodology = {
    title: 'How this is read',
    facts: [
      {
        label: 'The surprise',
        value:
          'Actual minus consensus, never minus the previous print. A number can be the highest in a year and still be a dovish surprise if it undershot what the market had braced for.',
      },
      {
        label: 'The convention',
        value:
          'Each release carries which way a higher number leans: CPI, PPI, PCE and payrolls tighten when hot; the unemployment rate and jobless claims ease when they rise.',
      },
      {
        label: 'The overnight aggregate',
        value:
          'A tally of leans, not an average. Conflicting inputs are called mixed rather than smoothed into a needle, and a quiet or stale board is mixed too.',
      },
      {
        label: 'The Japan 10-year',
        value:
          'Uses 1482.T — a JGB bond ETF — as a proxy, not the actual 10-year yield, which has no free live ticker. The number shown is a fund price, so a bond rally is a yield fall and the lean is inverted to match.',
        note: 'Being a fund, it carries its own noise — spread, fees and tracking error — that the underlying yield does not.',
      },
    ],
    assumption:
      'This is a mechanical reading of the surprise and the overnight tape. Markets frequently move against it — they price the whole distribution, not one number — so it is context only, not a forecast and not advice.',
    caveat:
      'It never says buy or sell. "Conditions tightened" describes the mechanics of a print; what to do about it is not something this card knows.',
    notes: overnight?.missing.length
      ? [`No overnight quote resolved for: ${overnight.missing.join(', ')}.`]
      : [],
  };

  return (
    <section aria-label="Overnight and macro translator" className="space-y-2">
      {/* Most recent release, translated — reading and tape in one line. */}
      {release && (
        <div className="panel border-l-2 border-l-term-line px-3.5 py-2.5">
          <div className="label-xs">Latest release</div>
          <p className="mt-1 text-xs leading-relaxed text-term-text">{release.line}</p>
        </div>
      )}

      {/*
        Gaps: due-or-overdue releases whose consensus was never entered. The
        loader drops them so no number is invented, but a forgotten entry that
        renders nothing is a silent failure — this makes the omission visible so
        it can be filled in. Amber, the site's "attention, not alarm" tone.
      */}
      {gaps.length > 0 && (
        <div className="panel border-l-2 border-l-flip/60 bg-flip/[0.06] px-3.5 py-2.5">
          <div className="label-xs text-flip">Consensus not entered</div>
          <ul className="mt-1 space-y-0.5">
            {gaps.map((gap) => (
              <li key={`${gap.event}-${gap.releaseAt}`} className="text-2xs leading-relaxed text-flip/90">
                <span className="font-bold">{gap.event}</span> — due {formatAsOf(new Date(gap.releaseAt))}, consensus not entered.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Overnight global rows. */}
      <div className="panel px-3.5 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label-xs">Overnight</span>
          <span className={`text-2xs font-bold uppercase tracking-[0.12em] ${AGG_TONE[verdict.aggregate]}`}>
            {verdict.aggregate}
          </span>
        </div>

        {stale ? (
          <p className="mt-2 border-l-2 border-l-bear bg-bear/[0.12] px-3 py-2 text-2xs leading-relaxed text-bear">
            {outage
              ? 'No overnight quotes came back, so the rows are withheld rather than shown from a feed that is down.'
              : `The overnight quotes are stale — last update ${formatAsOf(new Date(overnight!.at))}. The rows are withheld rather than shown from a feed that may be dead.`}
          </p>
        ) : (
          <>
            <ul className="mt-1.5 space-y-1">
              {overnight!.quotes.map((q) => (
                <li key={q.key} className="flex items-baseline gap-2 text-xs">
                  <span className="w-28 shrink-0 text-term-dim">
                    {q.label}
                    {q.proxy && (
                      <span className="text-term-faint" title="A stand-in, not the instrument itself.">
                        {q.unit}
                      </span>
                    )}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-term-text">
                    {Math.round(q.value * 100) / 100}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right tabular-nums ${
                      q.changePct > 0 ? 'text-bull' : q.changePct < 0 ? 'text-bear' : 'text-term-dim'
                    }`}
                  >
                    {signedPct(q.changePct)}
                  </span>
                  <span className="text-2xs leading-relaxed text-term-faint">{q.clause}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-term-line pt-2 text-2xs leading-relaxed text-term-dim">
              {verdict.sentence}
            </p>
          </>
        )}
      </div>

      {/* Next scheduled high-impact event with a countdown. */}
      {next && (
        <p className="panel px-3.5 py-2.5 text-xs text-term-dim">
          <span className="label-xs">Next up </span>
          <span className="ml-1 font-bold text-term-text">{next.event}</span>
          <span className="ml-1.5 tabular-nums text-term-faint">
            {formatAsOf(new Date(next.releaseAt))}
          </span>
          <span className="ml-1.5 tabular-nums text-flip">{countdown(next.releaseAt, now)}</span>
        </p>
      )}

      <MethodologyDrawer methodology={methodology} anchor="macro-translator" />
    </section>
  );
}
