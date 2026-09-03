import { formatPrice } from '@/lib/format';
import {
  SWING_CHECK_EXPLANATION,
  SWING_CHECK_LABEL,
  type SwingCandidate,
  type SwingCheck,
  type SwingView,
} from '@/lib/lab/swing/types';

/**
 * The swing candidate grid on /lab.
 *
 * A server component — nothing here is interactive. It reuses the existing
 * engines through `getSwingView` and renders each qualifying name as a card of
 * checkmarks, a gamma-room reading, risk flags and an explicit invalidation
 * level. It is an alignment read: every card is a name where a fixed set of
 * independent checks all point the same way at once, and the ticks say which.
 * It never phrases anything as odds, and it carries no buy/sell wording — a
 * direction is not an instruction, which is why every card ends by saying so.
 */

const CHECK_TONE: Record<SwingCheck['state'], string> = {
  pass: 'text-pos',
  fail: 'text-neg',
  unknown: 'text-flip',
};

const CHECK_MARK: Record<SwingCheck['state'], string> = {
  pass: '✓',
  fail: '✗',
  unknown: '?',
};

function ChecksGrid({ checks }: { checks: SwingCheck[] }) {
  return (
    <dl className="mt-2 space-y-1 text-2xs">
      {checks.map((c) => (
        <div key={c.key} className="flex gap-x-2">
          <dt className="flex w-32 shrink-0 items-baseline gap-1.5 font-bold tracking-[0.04em] text-term-faint">
            <span className={`${CHECK_TONE[c.state]} font-bold`}>{CHECK_MARK[c.state]}</span>
            <span title={SWING_CHECK_EXPLANATION[c.key]}>{SWING_CHECK_LABEL[c.key]}</span>
          </dt>
          <dd className="min-w-0 flex-1 leading-relaxed text-term-dim">{c.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

const OPTION_TONE: Record<SwingCandidate['options']['badge'], string> = {
  excellent: 'text-pos',
  tradable: 'text-pos',
  caution: 'text-flip',
  avoid: 'text-neg',
  unknown: 'text-term-faint',
  ungraded: 'text-term-faint',
};

function CandidateCard({ candidate }: { candidate: SwingCandidate }) {
  const dirTone = candidate.direction === 'bullish' ? 'text-pos' : 'text-neg';
  const room = candidate.gammaRoom;

  return (
    <div className="panel px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-term-text">{candidate.symbol}</span>
          <span className={`text-2xs font-bold uppercase tracking-[0.1em] ${dirTone}`}>
            {candidate.direction}
          </span>
        </div>
        <span className="text-2xs tabular-nums text-term-faint">
          {candidate.passed}/{candidate.checks.length} aligned
        </span>
      </div>

      <div className="mt-0.5 flex items-baseline gap-2 text-2xs text-term-faint">
        {candidate.sectorName && <span>{candidate.sectorName}</span>}
        {candidate.price !== null && (
          <span className="tabular-nums">
            {formatPrice(candidate.price)}
            <span className="ml-1 text-term-line">
              {candidate.priceSource === 'live' ? 'live' : 'stored'}
            </span>
          </span>
        )}
      </div>

      <ChecksGrid checks={candidate.checks} />

      {/* Gamma room — shown, never scored into a direction. */}
      <div className="mt-2 border-t border-term-line pt-2 text-2xs leading-relaxed text-term-dim">
        <span className="font-bold tracking-[0.04em] text-term-faint">Gamma room </span>
        {room.pct !== null && room.level !== null ? (
          <span className="tabular-nums">
            {Math.abs(room.pct).toFixed(1)}% to the next {room.levelKind} at{' '}
            {formatPrice(room.level)}
          </span>
        ) : (
          <span className="text-term-faint">{room.note}</span>
        )}
      </div>

      {/* Risk flags. */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs">
        <span>
          <span className="font-bold tracking-[0.04em] text-term-faint">Options </span>
          <span className={OPTION_TONE[candidate.options.badge]}>{candidate.options.detail}</span>
        </span>
        <span>
          <span className="font-bold tracking-[0.04em] text-term-faint">Earnings </span>
          <span
            className={
              candidate.earnings.state === 'unknown'
                ? 'text-flip'
                : candidate.earnings.state === 'inside'
                  ? 'text-neg'
                  : 'text-term-dim'
            }
          >
            {candidate.earnings.detail}
          </span>
        </span>
        {candidate.elevatedIv && <span className="text-flip">elevated IV</span>}
      </div>

      {/* Explicit invalidation level, on every card. */}
      <p className="mt-2 text-2xs leading-relaxed text-term-dim">
        <span className="font-bold tracking-[0.04em] text-term-faint">Invalidation </span>
        {candidate.invalidationNote}
      </p>

      <p className="mt-2 text-2xs italic text-term-faint">
        research candidate, not a trade instruction.
      </p>
    </div>
  );
}

function Column({
  title,
  tone,
  candidates,
}: {
  title: string;
  tone: string;
  candidates: SwingCandidate[];
}) {
  return (
    <div>
      <h3 className={`label-xs ${tone}`}>
        {title} · {candidates.length}
      </h3>
      {candidates.length > 0 ? (
        <div className="mt-2 space-y-3">
          {candidates.map((c) => (
            <CandidateCard key={`${c.direction}-${c.symbol}`} candidate={c} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-2xs leading-relaxed text-term-faint">
          No name has every check aligned in this direction right now. That is a real reading, not
          an empty page — the engine shows every name that qualifies and no fixed count.
        </p>
      )}
    </div>
  );
}

export function SwingBoard({ view }: { view: SwingView }) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Column title="Bullish" tone="text-pos" candidates={view.bullish} />
        <Column title="Bearish" tone="text-neg" candidates={view.bearish} />
      </div>

      {view.excluded.length > 0 && (
        <div className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h3 className="label-xs">Aligned, but hard-excluded</h3>
          <p className="mt-1 text-term-dim">
            These cleared the market, sector, trend and RS checks, then a single hard exclusion
            removed them entirely — not lowered a score. Shown so the exclusions are visible rather
            than silent.
          </p>
          <ul className="mt-1.5 space-y-1">
            {view.excluded.map((e) => (
              <li key={`${e.direction}-${e.symbol}`}>
                <span className="font-bold text-term-dim">{e.symbol}</span>{' '}
                <span
                  className={e.direction === 'bullish' ? 'text-pos/80' : 'text-neg/80'}
                >
                  {e.direction}
                </span>{' '}
                — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
