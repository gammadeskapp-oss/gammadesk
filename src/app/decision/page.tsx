import type { Metadata } from 'next';
import Link from 'next/link';
import { DecisionSearch } from '@/components/DecisionSearch';
import { Footer } from '@/components/Footer';
import { InteractiveChart } from '@/components/InteractiveChart';
import { PageBar } from '@/components/PageBar';
import { config } from '@/lib/config';
import { DecisionError, getDecision, type DecisionResult } from '@/lib/decision';
import type { Grade, Wall } from '@/lib/decision/types';
import { formatPrice, formatStrike, formatUsd } from '@/lib/format';
import { normaliseSymbol } from '@/lib/ticker/bars';

export const metadata: Metadata = {
  title: 'Decision',
  description:
    'Positioning, levels, a conviction check and an interactive chart for one ticker, on one screen.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ symbol?: string }>;
}

const GRADE_TEXT: Record<Grade, string> = {
  green: 'text-bull',
  amber: 'text-flip',
  red: 'text-bear',
};

const GRADE_EDGE: Record<Grade, string> = {
  green: 'border-l-bull/60',
  amber: 'border-l-flip/60',
  red: 'border-l-bear/60',
};

const GRADE_MARK: Record<Grade, string> = {
  green: '●',
  amber: '●',
  red: '●',
};

function Section({
  step,
  title,
  tip,
  children,
}: {
  step: number;
  title: string;
  tip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-xs font-bold text-pos">{step}</span>
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
          {title}
        </h2>
        {tip}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'flip' | 'bull' | 'bear';
}) {
  const colour = {
    neutral: 'text-term-text',
    pos: 'text-pos',
    neg: 'text-neg',
    flip: 'text-flip',
    bull: 'text-bull',
    bear: 'text-bear',
  }[tone];
  const edge = {
    neutral: 'border-term-line',
    pos: 'border-pos/40',
    neg: 'border-neg/40',
    flip: 'border-flip/40',
    bull: 'border-bull/40',
    bear: 'border-bear/40',
  }[tone];

  return (
    <div className={`panel border-l-2 px-3.5 py-2.5 ${edge}`}>
      <div className="label-xs">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-term-faint">{sub}</div>}
    </div>
  );
}

function WallRow({ wall, spot }: { wall: Wall; spot: number }) {
  const pct = Math.round(wall.strength * 100);
  return (
    <li className="flex items-center gap-3 px-3.5 py-2 text-xs tabular-nums">
      <span className="w-16 shrink-0 font-bold text-term-text">
        {formatStrike(wall.strike)}
      </span>
      <span
        className={`w-16 shrink-0 text-2xs ${
          Math.abs(wall.distancePct) < 0.5 ? 'text-flip' : 'text-term-faint'
        }`}
      >
        {wall.distancePct >= 0 ? '+' : ''}
        {wall.distancePct.toFixed(2)}%
      </span>

      {/* Strength as a bar, relative to the biggest wall on the same side. */}
      <span className="h-1.5 min-w-0 flex-1 bg-term-line" aria-hidden>
        <span
          className={`block h-full ${wall.gex >= 0 ? 'bg-pos' : 'bg-neg'}`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </span>

      <span className="w-10 shrink-0 text-right text-2xs text-term-dim">{pct}%</span>
      <span
        className={`w-20 shrink-0 text-right ${wall.gex >= 0 ? 'text-pos' : 'text-neg'}`}
      >
        {formatUsd(wall.gex)}
      </span>
      <span className="sr-only">
        {wall.strike} is {pct} percent as strong as the largest wall on this side,
        {spot > wall.strike ? ' below' : ' above'} the current price.
      </span>
    </li>
  );
}

function Decision({ data }: { data: DecisionResult }) {
  const { context: c, walls, conviction, verdict } = data;

  return (
    <>
      {/* 1 — CONTEXT */}
      <Section
        step={1}
        title="Context"
        tip={<span className="text-2xs text-term-faint">from the positioning book</span>}
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <Tile label={`${c.symbol} spot`} value={formatPrice(c.spot)} />
          <Tile
            label="Gamma regime"
            value={c.mood === 'calm' ? 'CALM' : 'WILD'}
            sub={c.mood === 'calm' ? 'moves tend to fade' : 'moves tend to run'}
            tone={c.mood === 'calm' ? 'pos' : 'neg'}
          />
          <Tile
            label="Gamma flip"
            value={c.flipLevel === null ? '—' : formatPrice(c.flipLevel)}
            sub={
              c.aboveFlip === null
                ? 'no crossing nearby'
                : `${c.aboveFlip ? 'above' : 'below'} · ${c.flipDistancePct! >= 0 ? '+' : ''}${c.flipDistancePct!.toFixed(2)}%`
            }
            tone="flip"
          />
          <Tile
            label="Magnet above"
            value={c.magnetAbove ? formatStrike(c.magnetAbove.strike) : '—'}
            sub={c.magnetAbove ? formatUsd(c.magnetAbove.gex) : 'none nearby'}
            tone={c.magnetAbove ? (c.magnetAbove.gex >= 0 ? 'pos' : 'neg') : 'neutral'}
          />
          <Tile
            label="Magnet below"
            value={c.magnetBelow ? formatStrike(c.magnetBelow.strike) : '—'}
            sub={c.magnetBelow ? formatUsd(c.magnetBelow.gex) : 'none nearby'}
            tone={c.magnetBelow ? (c.magnetBelow.gex >= 0 ? 'pos' : 'neg') : 'neutral'}
          />
        </div>
      </Section>

      {/* 2 — LEVELS */}
      <Section step={2} title="Levels">
        <div className="grid gap-2 lg:grid-cols-2">
          {(
            [
              ['Walls above', walls.above, 'bull'],
              ['Walls below', walls.below, 'bear'],
            ] as const
          ).map(([title, list, tone]) => (
            <div key={title} className="panel">
              <div className="flex items-baseline justify-between border-b border-term-line px-3.5 py-2">
                <h3 className={`label-xs ${tone === 'bull' ? 'text-bull' : 'text-bear'}`}>
                  {title}
                </h3>
                <span className="text-2xs text-term-faint">nearest first</span>
              </div>
              {list.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-xs text-term-dim">
                  No meaningful gamma on this side.
                </p>
              ) : (
                <ul className="divide-y divide-term-line/60">
                  {list.map((w) => (
                    <WallRow key={w.strike} wall={w} spot={c.spot} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="text-2xs leading-relaxed text-term-faint">
          Strength is relative to the largest wall on the same side, not across
          both — a 100% bar below does not mean the floor is stronger than the
          ceiling. Amber bars are positive gamma (dealers lean against moves),
          blue is negative.
        </p>
      </Section>

      {/* 3 — CONVICTION */}
      <Section
        step={3}
        title="Conviction check"
        tip={
          conviction.level !== null ? (
            <span className="text-2xs text-term-faint">
              measured against {formatStrike(conviction.level)}, the nearest level{' '}
              {conviction.side}
            </span>
          ) : undefined
        }
      >
        {conviction.unavailable ? (
          <div className="panel px-4 py-6 text-center text-xs text-term-dim">
            {conviction.note}
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {conviction.checks.map((check) => (
              <div
                key={check.id}
                className={`panel border-l-2 ${GRADE_EDGE[check.grade]} px-3.5 py-3`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="label-xs">{check.label}</span>
                  <span aria-hidden className={`text-sm ${GRADE_TEXT[check.grade]}`}>
                    {GRADE_MARK[check.grade]}
                  </span>
                </div>
                <div className={`mt-1 text-lg font-bold tabular-nums ${GRADE_TEXT[check.grade]}`}>
                  {check.value}
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
                  {check.detail}
                </p>
                <span className="sr-only">Rated {check.grade}.</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-2xs leading-relaxed text-term-faint">
          These thresholds are conventions, not measured edges. A first touch is
          widely treated as more reliable than a third, and a move that covers
          most of the day&rsquo;s range in minutes is widely treated as
          stretched. Both are beliefs about markets; the page applies them
          consistently and shows its working so you can disagree with it.
        </p>
      </Section>

      {/* 4 — CHART */}
      <Section step={4} title="Chart">
        <InteractiveChart symbol={c.symbol} />
      </Section>

      {/* 5 — VERDICT */}
      <Section step={5} title="Verdict">
        <div className={`panel border-l-2 ${GRADE_EDGE[verdict.tone]} p-4 sm:p-5`}>
          <p className="text-base leading-relaxed text-term-text">{verdict.line}</p>

          {verdict.conflict && (
            <p className="mt-3 border-t border-term-line pt-3 text-sm leading-relaxed text-flip">
              <span className="font-bold">Signals conflict. </span>
              {verdict.conflict}
            </p>
          )}

          <p className="mt-3 border-t border-term-line pt-3 text-2xs leading-relaxed text-term-faint">
            This describes conditions. It is not a recommendation to buy or sell
            anything, and no combination of these readings will ever produce
            one — knowing the tape is calm and there is a wall overhead does not
            tell you which way price goes next, only what behaviour to expect if
            it gets there.
          </p>
        </div>
      </Section>
    </>
  );
}

export default async function DecisionPage({ searchParams }: PageProps) {
  const { symbol } = await searchParams;
  const query = symbol?.trim() || config.symbol;

  let data: DecisionResult | null = null;
  let error: string | null = null;

  try {
    data = await getDecision(query);
  } catch (e) {
    error =
      e instanceof DecisionError
        ? e.message
        : `Could not read the option chain for ${query}.`;
  }

  // Sanitised here too, because on the failure path there is no result object
  // to take a validated symbol from.
  const chartSymbol = normaliseSymbol(query);

  return (
    <>
      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 px-4 py-5 sm:px-6">
        <PageBar
          title="Decision"
          meta="one screen, top to bottom"
          asOfLabel={data?.context.asOfLabel}
        />

        <DecisionSearch initial={data?.context.symbol ?? query} />

        {error && (
          <div className="panel border-l-2 border-l-bear/60 px-4 py-4">
            <p className="text-xs font-bold text-bear">{error}</p>
            <p className="mt-1.5 text-2xs text-term-dim">
              The context, levels and conviction checks all come from the option
              chain, so they are unavailable — but the chart does not need
              options and is still below. Try{' '}
              <Link href="/decision?symbol=SPY" className="text-pos underline decoration-dotted">
                SPY
              </Link>{' '}
              if this name has no listed options.
            </p>
          </div>
        )}

        {data && <Decision data={data} />}

        {/*
          The chart survives a chain failure on purpose. Its bars come from a
          different source entirely, and losing the whole screen because the
          options feed is down would throw away the part that still works.
        */}
        {!data && chartSymbol && (
          <Section step={4} title="Chart">
            <InteractiveChart symbol={chartSymbol} />
          </Section>
        )}

        {data && data.notes.length > 0 && (
          <ul className="panel space-y-1 px-3.5 py-3 text-2xs text-flip/80">
            {data.notes.map((n) => (
              <li key={n}>! {n}</li>
            ))}
          </ul>
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">Everything here is delayed. </span>
            Option chains are delayed quotes and the price bars are fifteen
            minutes behind, which is stated again on the chart itself. Nothing
            on this page is a live tape, and it should not be used as one.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">It adds no new data. </span>
            The context and levels are the same numbers as the{' '}
            <Link href="/" className="text-term-dim underline decoration-dotted">
              positioning
            </Link>{' '}
            page; the page exists to put them next to the chart rather than a
            click apart. The dealer convention behind the gamma figures is an
            assumption, and it is sometimes wrong.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
