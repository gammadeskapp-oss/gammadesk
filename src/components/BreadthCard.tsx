'use client';

import { useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Sparkline } from '@/components/Sparkline';
import { breadthBand } from '@/lib/breadth/compute';
import type { BreadthReading } from '@/lib/breadth/types';
import {
  breadthSentence,
  participationWords,
  recentSentence,
  spreadSentence,
} from '@/lib/breadth/wording';

/**
 * "Is the whole market moving, or just a few big names?"
 *
 * Sits in the context row at the top of /decision, beside the regime and the
 * flip, because it is market-wide context rather than a level.
 *
 * Self-contained on purpose: it takes one prop, assumes nothing about its
 * neighbours, and sets no width of its own. When /decision is later split into
 * tabs this moves by being re-parented, not rewritten.
 */

const TONE = {
  high: {
    value: 'text-bull',
    edge: 'border-l-bull/60',
    rising: true,
  },
  middle: {
    value: 'text-term-text',
    edge: 'border-l-term-line',
    rising: true,
  },
  low: {
    value: 'text-bear',
    edge: 'border-l-bear/60',
    rising: false,
  },
} as const;

export function BreadthCard({
  reading,
  closedNote,
}: {
  reading: BreadthReading;
  /**
   * One sentence about the market clock, written on the server.
   *
   * Breadth is a live count and genuinely has no value outside a session — the
   * series is today's samples, so overnight there is nothing to fall back on
   * and nothing to stamp. The empty card was therefore honest and still read
   * as broken, because it said the reading is taken while the market is open
   * without saying that the market is shut and when it opens again. Passed in
   * rather than read here: this is a client component, and a clock read during
   * hydration produces a different string from the one the server rendered.
   */
  closedNote?: string;
}) {
  const [explain, setExplain] = useState(false);
  const { computed, spread, series } = reading;

  const band = computed ? breadthBand(computed.pctAbovePriorClose) : 'middle';
  const tone = TONE[band];

  /*
   * The sparkline needs a shape, not a data point. One reading is a dot, and a
   * dot drawn as a trend line is a claim about a trend that has not been
   * measured yet.
   */
  const spark = series.length >= 2 ? series.map((s) => s.pctAbovePriorClose) : null;

  return (
    <div className={`panel border-l-2 ${tone.edge} px-3.5 py-2.5`}>
      <div className="flex items-center gap-1.5">
        <span className="label-xs">Breadth</span>
        <InfoTip for="breadth" />
      </div>

      {computed === null ? (
        <>
          <div className="mt-1 text-lg font-bold tabular-nums text-term-dim">—</div>
          <p className="mt-0.5 text-2xs leading-relaxed text-term-faint">
            No reading yet today. It is taken every minute while the market is
            open.
            {closedNote ? ` ${closedNote}` : ''}
          </p>
        </>
      ) : (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className={`text-lg font-bold tabular-nums ${tone.value}`}>
              {Math.round(computed.pctAbovePriorClose)}%
            </span>
            {spark && (
              <Sparkline
                values={spark}
                rising={tone.rising}
                label={`Breadth through the session, now ${Math.round(computed.pctAbovePriorClose)} percent.`}
                width={64}
                height={20}
              />
            )}
          </div>

          {/*
            One sentence, and it is the meaning rather than the number. The
            rest — the split, the two-fund cross-check, the caveats — is one
            click away, so this card keeps roughly the footprint of the regime
            tile beside it.
          */}
          <p className="mt-1 text-2xs leading-relaxed text-term-faint">
            {breadthSentence(computed)}
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => setExplain((v) => !v)}
        aria-expanded={explain}
        aria-controls="breadth-explain"
        className={`mt-2 border px-2 py-1 text-2xs tracking-[0.08em] transition-colors ${
          explain
            ? 'border-pos/60 bg-pos/12 text-pos'
            : 'border-term-line text-term-dim hover:border-term-edge hover:text-term-text'
        }`}
      >
        {explain ? '▾' : '▸'} What am I looking at?
      </button>

      {explain && (
        <div
          id="breadth-explain"
          className="mt-2 border-t border-term-line pt-2 text-2xs leading-relaxed text-term-dim"
        >
          <p className="text-term-text">
            Imagine a class of 500 students sitting a test.
          </p>
          <p className="mt-1.5">
            The class average can look fine because a few top students did
            brilliantly. Breadth tells you how the rest of the class did.
          </p>
          <p className="mt-1.5">
            The index can fall on two or three very large companies while most
            others are fine. That is a narrow move. When most are falling too,
            that is a broad one.
          </p>

          {computed && (
            <ul className="mt-2 space-y-1">
              <li className="text-term-text">{participationWords(computed)}</li>
              <li>
                <span className="text-term-text">{computed.counts.advancers}</span> up,{' '}
                <span className="text-term-text">{computed.counts.decliners}</span> down,{' '}
                <span className="text-term-text">{computed.counts.unchanged}</span>{' '}
                unchanged, of {computed.counts.measured} measured.
              </li>
              {recentSentence(computed) && (
                <li className="flex items-start gap-1">
                  <span>{recentSentence(computed)}</span>
                  <InfoTip for="breadthGreen15" className="mt-px" />
                </li>
              )}
              {computed.pctAboveSessionAverage !== null && (
                <li className="flex items-start gap-1">
                  <span>
                    {Math.round(computed.pctAboveSessionAverage)}% are above their own
                    average price so far today.
                  </span>
                  <InfoTip for="breadthAverage" className="mt-px" />
                </li>
              )}
            </ul>
          )}

          {/*
            Method B, the two-symbol cross-check. It runs on every refresh
            because it is one request and it is independent of the constituent
            sweep — two methods disagreeing is worth being able to see.
          */}
          {spread && (
            <p className="mt-2 flex items-start gap-1 border-t border-term-line pt-2">
              <span>{spreadSentence(spread)}</span>
              <InfoTip for="breadthSpread" className="mt-px" />
            </p>
          )}

          {/* The honesty box. Same convention as everywhere else on the site. */}
          <div className="mt-2.5 border-t border-term-line pt-2 text-term-faint">
            <p>
              <span className="text-term-dim">What this is not. </span>
              It counts S&amp;P 500 companies only. It is not the full New York
              Stock Exchange advance/decline line, which covers every listed
              company, so it will not match that figure.
            </p>
            <p className="mt-1.5">
              Prices are delayed, so the reading describes a few minutes ago,
              not this second. It is taken once a minute while the market is
              open.
            </p>
            <p className="mt-1.5">
              Breadth describes how many are taking part. It says nothing about
              which way price moves next.
            </p>
            {reading.notes.map((note) => (
              <p key={note} className="mt-1.5 text-flip/80">
                ! {note}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
