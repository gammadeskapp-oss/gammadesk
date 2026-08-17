import { InfoTip } from '@/components/InfoTip';
import { Sparkline } from '@/components/Sparkline';
import { formatUsd } from '@/lib/format';
import type { NetLiquidityDirection, NetLiquidityResult } from '@/lib/netLiquidity';

/**
 * US net liquidity — regime context in the dashboard's top strip.
 *
 * Deliberately not wired to anything. It is a slow macro series sitting
 * beside fast per-ticker readings, and the header says so, because a number
 * placed next to a score reads as an input to it.
 *
 * Expansion is a plain `<details>`: it opens on click and on keyboard, works
 * without JavaScript, and is never hover-only.
 */

const DIRECTION: Record<
  NetLiquidityDirection,
  { arrow: string; word: string; text: string; edge: string }
> = {
  rising: { arrow: '▲', word: 'Rising', text: 'text-bull', edge: 'border-l-bull/60' },
  falling: { arrow: '▼', word: 'Falling', text: 'text-bear', edge: 'border-l-bear/60' },
  // Flat gets a neutral bar rather than an arrow — an arrow is a direction
  // claim, and below the threshold there is no direction to claim.
  flat: { arrow: '—', word: 'Flat', text: 'text-term-dim', edge: 'border-l-term-line' },
};

/** `week of 2026-08-12` → `week of AUG 12` for the tile face. */
function weekLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${months[idx]} ${d}`;
}

function signed(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${formatUsd(value)}`;
}

function signedPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function NetLiquidityUnavailable() {
  return (
    <section
      aria-label="US net liquidity"
      className="panel border-l-2 border-l-term-line px-3.5 py-3"
    >
      <h2 className="label-xs">US net liquidity</h2>
      <div className="mt-1 text-lg font-bold text-term-faint">—</div>
      <p className="mt-1 text-2xs leading-relaxed text-term-faint">
        Data unavailable — the FRED series could not be read. Nothing is
        substituted for it.
      </p>
    </section>
  );
}

export function NetLiquidityTile({ data }: { data: NetLiquidityResult }) {
  const { latest, history } = data;
  const tone = DIRECTION[latest.direction ?? 'flat'];

  // Oldest first, so the line reads left to right like every other chart here.
  const series = history.map((w) => w.net);

  return (
    <section
      aria-label="US net liquidity"
      className={`panel border-l-2 ${tone.edge} px-3.5 py-3`}
    >
      <div className="flex items-center gap-1.5">
        <h2 className="label-xs">US net liquidity</h2>
        <InfoTip
          tip={{
            label: 'US net liquidity',
            plain:
              "Roughly how much cash the US financial system has to play with: the Fed's balance sheet, minus the government's own cash pile, minus money parked back at the Fed overnight.",
            detail:
              'WALCL − WTREGEN − RRPONTSYD, from FRED. US only — this is not global liquidity, which would need ECB, BOJ and PBOC balance sheets converted through FX and is not covered here. Regime context: it is not an input to any signal, score or verdict on this site.',
          }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xl font-bold tabular-nums leading-none text-term-text">
          {formatUsd(latest.net)}
        </span>
        <span className={`flex items-baseline gap-1 text-xs font-bold ${tone.text}`}>
          <span aria-hidden>{tone.arrow}</span>
          <span>{tone.word}</span>
          <span className="tabular-nums font-normal">
            {signedPct(latest.changePct)}
          </span>
        </span>
        <Sparkline
          values={series}
          rising={latest.direction === 'rising'}
          label={`US net liquidity over the last ${history.length} weekly prints`}
          width={84}
        />
      </div>

      <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
        week of {weekLabel(latest.weekOf)} · change is week over week, never
        daily. Moves under {data.flatThresholdPct}% are shown as Flat.
      </p>

      <details className="group mt-2 border-t border-term-line pt-2">
        <summary className="cursor-pointer list-none text-2xs text-term-faint transition-colors hover:text-term-dim">
          <span className="underline decoration-dotted underline-offset-2">
            recent weekly prints
          </span>
          <span aria-hidden className="ml-1 group-open:hidden">
            ▸
          </span>
          <span aria-hidden className="ml-1 hidden group-open:inline">
            ▾
          </span>
        </summary>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-2xs tabular-nums">
            <caption className="sr-only">
              US net liquidity by week, oldest first, with its three components.
            </caption>
            <thead>
              <tr className="border-b border-term-line text-term-faint">
                <th scope="col" className="py-1 text-left font-normal">
                  week of
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  net
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  change
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  balance sheet
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  TGA
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  reverse repo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-term-line/60">
              {[...history].reverse().map((w) => (
                <tr key={w.weekOf}>
                  <th scope="row" className="py-1 text-left font-normal text-term-dim">
                    {w.weekOf}
                  </th>
                  <td className="py-1 text-right text-term-text">{formatUsd(w.net)}</td>
                  <td
                    className={`py-1 text-right ${
                      w.direction === null || w.direction === 'flat'
                        ? 'text-term-faint'
                        : w.direction === 'rising'
                          ? 'text-bull'
                          : 'text-bear'
                    }`}
                  >
                    {signed(w.changeUsd)}
                  </td>
                  <td className="py-1 text-right text-term-faint">{formatUsd(w.walcl)}</td>
                  <td className="py-1 text-right text-term-faint">{formatUsd(w.tga)}</td>
                  <td className="py-1 text-right text-term-faint">{formatUsd(w.rrp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-2xs leading-relaxed text-term-faint">
          Every row is measured, not projected — nothing here is extrapolated
          from the announced runoff schedule or the published TGA targets. The
          balance sheet and TGA print weekly on a Wednesday and are revised
          afterwards; reverse repo is daily and is read as of the same
          Wednesday, so a fresh repo number never moves a stale weekly pair.
          Read {data.fetchedAtLabel}.
        </p>
      </details>
    </section>
  );
}
