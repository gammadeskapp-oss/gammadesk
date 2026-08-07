import type { ReactNode } from 'react';
import { METRICS } from '@/lib/metrics';
import type { MetricKey } from '@/lib/types';

interface ExplainPanelProps {
  metric: MetricKey;
}

function Line({ swatch, children }: { swatch?: string; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      {swatch ? (
        <span
          aria-hidden
          className="mt-[0.4rem] h-2.5 w-2.5 shrink-0"
          style={{ backgroundColor: swatch }}
        />
      ) : (
        <span aria-hidden className="mt-[0.35rem] shrink-0 text-term-faint">
          ›
        </span>
      )}
      <span>{children}</span>
    </li>
  );
}

export function ExplainPanel({ metric }: ExplainPanelProps) {
  const def = METRICS[metric];

  return (
    <div className="panel border-l-2 border-l-pos/50 p-4 text-xs leading-relaxed text-term-dim">
      <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-pos">
        {def.tab} — {def.name}
      </h2>

      <p className="mt-2.5 text-term-text">{def.plain.what}</p>

      <ul className="mt-3 space-y-2">
        <Line swatch="#22d3ee">{def.plain.positive}</Line>
        <Line swatch="#ff3fb4">{def.plain.negative}</Line>
        <Line>{def.plain.why}</Line>
      </ul>

      <div className="mt-4 border-t border-term-line pt-3">
        <h3 className="label-xs">How to read the table</h3>
        <ul className="mt-2 space-y-1.5">
          <li>
            Each <span className="text-term-text">row is a strike price</span>;
            each <span className="text-term-text">column is an expiration date</span>.
            The right-hand <span className="text-term-text">TOTAL</span> column adds
            up every expiration for that strike.
          </li>
          <li>
            <span className="text-pos">Brighter cyan</span> or{' '}
            <span className="text-neg">brighter magenta</span> just means a bigger
            number. Faint cells barely matter.
          </li>
          <li>
            The <span className="text-pos">cyan row</span> is the strike closest to
            the current price. The{' '}
            <span className="text-flip">yellow row</span> is the gamma flip level,
            where dealer behaviour switches from dampening moves to amplifying them.
          </li>
          <li>
            &ldquo;Dealers&rdquo; are the market makers on the other side of every
            options trade. They hedge in the underlying, and that hedging is real
            buying and selling pressure — which is what this whole dashboard is
            trying to estimate.
          </li>
        </ul>
      </div>

      <p className="mt-4 border-t border-term-line pt-3 text-2xs text-term-faint">
        Units: {def.unit}. Positioning is modelled on the standard convention that
        dealers are long calls and short puts; that is an assumption, not observed
        data, and it will sometimes be wrong.
      </p>
    </div>
  );
}
