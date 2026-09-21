'use client';

import { useState, useSyncExternalStore } from 'react';
import { InfoTip } from '@/components/InfoTip';
import type { LevelKind, LevelMap, LevelRung } from '@/lib/decision/levelMap';
import type { ActivityLevels, Wall } from '@/lib/decision/types';
import { formatPrice, formatStrike, formatUsd } from '@/lib/format';
import type { TooltipKey } from '@/lib/tooltips';

/**
 * Which weighting drives the levels: standing open interest, or the contracts
 * that actually traded this session. Remembered per device — see the effect in
 * `LevelsPanel` — because it is a reading preference, not something the server
 * needs to know.
 */
type Weighting = 'standard' | 'activity';

const WEIGHTING_STORAGE_KEY = 'gammadesk:levels-weighting';
const WEIGHTING_EVENT = 'gammadesk:levels-weighting-change';
const DEFAULT_WEIGHTING: Weighting = 'standard';

const WEIGHTING_LABEL: Record<Weighting, string> = {
  standard: 'Standard',
  activity: "Today's activity",
};

/*
 * The choice is read through an external store rather than seeded into
 * `useState`, for the same reason the context band's horizon is: the server has
 * no storage, so seeding state from `localStorage` would make the first client
 * render disagree with the server's and throw a hydration mismatch. The server
 * renders the Standard default, the browser re-renders with the stored value,
 * and hydration stays consistent. Every accessor is wrapped because storage
 * throws in private windows and when site data is blocked.
 */
function readWeighting(): Weighting {
  try {
    return window.localStorage.getItem(WEIGHTING_STORAGE_KEY) === 'activity'
      ? 'activity'
      : 'standard';
  } catch {
    return DEFAULT_WEIGHTING;
  }
}

function writeWeighting(next: Weighting): void {
  try {
    window.localStorage.setItem(WEIGHTING_STORAGE_KEY, next);
  } catch {
    // Storage unavailable; the choice holds for this view but will not persist.
  }
  window.dispatchEvent(new CustomEvent(WEIGHTING_EVENT));
}

function subscribeWeighting(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(WEIGHTING_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(WEIGHTING_EVENT, onChange);
  };
}

/**
 * Section 2, and the switch between its two readings.
 *
 * The walls view splits the chain into what is above and what is below. The
 * level map lays the same levels on one ladder, which is the only shape with
 * anywhere to put the two zero-gamma crossings — they are not strikes, so they
 * belong to neither list.
 *
 * Both views are built from the same payload and the same wall rule; the
 * toggle only decides which is on screen. That is also why the whole section
 * is a client component: the switch sits in the section header, beside the
 * title, and the header and the body have to share one piece of state.
 */

type View = 'walls' | 'map';

const VIEW_LABEL: Record<View, string> = {
  walls: 'Walls',
  map: 'Level map',
};

/** Display text, wording key, and colour for each label a rung can carry. */
const LABEL_META: Record<
  LevelKind,
  { text: string; tip: TooltipKey; className: string }
> = {
  spot: {
    text: 'SPOT',
    tip: 'spot',
    className: 'border-flip/70 bg-flip/15 text-flip',
  },
  heaviest: {
    text: 'HEAVIEST',
    tip: 'levelHeaviest',
    className: 'border-term-text/60 bg-term-text/10 text-term-text',
  },
  ceiling: {
    text: 'CEILING',
    tip: 'levelCeiling',
    className: 'border-bull/60 bg-bull/10 text-bull',
  },
  floor: {
    text: 'FLOOR',
    tip: 'levelFloor',
    className: 'border-bear/60 bg-bear/10 text-bear',
  },
  flip: {
    text: 'GAMMA FLIP',
    tip: 'levelFlip',
    className: 'border-pos/60 bg-pos/10 text-pos',
  },
  frontFlip: {
    text: 'FRONT-WEEK FLIP',
    tip: 'levelFrontFlip',
    className: 'border-pos/40 text-pos/90',
  },
  wall: {
    text: 'WALL',
    tip: 'levelWall',
    className: 'border-term-line text-term-dim',
  },
};

/**
 * A label badge that is also its own tooltip trigger.
 *
 * The rule behind a level is the whole reason to trust it, and WALL repeats
 * down the ladder — a separate `?` beside every badge would be noise. Making
 * the badge the trigger keeps every rung self-explaining at no visual cost.
 */
function LabelBadge({ kind }: { kind: LevelKind }) {
  const meta = LABEL_META[kind];
  return (
    <InfoTip for={meta.tip}>
      <span
        className={`border px-1.5 py-px text-[10px] font-bold tracking-[0.08em] ${meta.className}`}
      >
        {meta.text}
      </span>
    </InfoTip>
  );
}

/** Labels that only ever sit on a real strike. */
const STRIKE_LABELS: LevelKind[] = ['wall', 'heaviest', 'ceiling', 'floor'];

/**
 * The badge that marks a Standard-view level today's trading also backs.
 *
 * Only ever shown on the open-interest view: it is a statement about volume
 * agreeing with open interest, which is meaningless on the volume view itself.
 */
function ConfirmedChip() {
  return (
    <InfoTip for="levelConfirmedByVolume">
      <span className="border border-pos/50 bg-pos/10 px-1.5 py-px text-[10px] font-bold tracking-[0.06em] text-pos">
        CONFIRMED BY TODAY&rsquo;S TRADING
      </span>
    </InfoTip>
  );
}

function RungRow({
  rung,
  showExposure,
  confirmed,
}: {
  rung: LevelRung;
  showExposure: boolean;
  /** True on the Standard view when this level also appears in the volume view. */
  confirmed: boolean;
}) {
  const near = !rung.isSpot && Math.abs(rung.distancePct) < 0.5;

  /*
   * Strike labels drop a trailing zero — 772.50 is a strike, 772.5 reads as
   * one, and `formatStrike` exists for that. A solved flip is a price, so it
   * keeps both decimals and matches the same figure in the context tiles
   * above; printing 767.1 there and 767.10 here is the same number twice.
   */
  const isStrike = rung.labels.some((l) => STRIKE_LABELS.includes(l));

  return (
    <li
      className={`flex items-center gap-2.5 px-3 py-2 text-xs tabular-nums ${
        rung.isSpot ? 'border-l-2 border-l-flip bg-flip/10' : 'border-l-2 border-l-transparent'
      }`}
    >
      <span
        className={`w-16 shrink-0 font-bold ${
          rung.isSpot ? 'text-flip' : 'text-term-text'
        }`}
      >
        {isStrike ? formatStrike(rung.price) : formatPrice(rung.price)}
      </span>

      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {rung.labels.map((l) => (
          <LabelBadge key={l} kind={l} />
        ))}
        {confirmed && <ConfirmedChip />}
      </span>

      {/*
        Dollar gamma, and a dash where there is none. The flips are solved
        positions on a continuous curve rather than strikes, so they carry no
        open interest of their own — an empty cell there is the honest cell.
      */}
      <span
        className={`w-20 shrink-0 text-right ${
          rung.gex === null
            ? 'text-term-faint'
            : rung.gex >= 0
              ? 'text-pos'
              : 'text-neg'
        }`}
      >
        {rung.gex === null ? '—' : showExposure ? formatUsd(rung.gex) : '·'}
      </span>

      <span
        className={`w-16 shrink-0 text-right text-2xs ${
          rung.isSpot || near ? 'text-flip' : 'text-term-faint'
        }`}
      >
        {rung.isSpot
          ? '—'
          : `${rung.distancePct >= 0 ? '+' : ''}${rung.distancePct.toFixed(2)}%`}
      </span>
    </li>
  );
}

function LevelMapView({
  map,
  asOfLabel,
  showExposure,
  confirmedPrices,
}: {
  map: LevelMap;
  asOfLabel: string;
  showExposure: boolean;
  /** Prices to tag "confirmed by today's trading"; empty on the volume view. */
  confirmedPrices: Set<number>;
}) {
  return (
    <div className="border border-term-line">
      {/* What the ladder was built from. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-term-line px-3 py-2">
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xs">
          <span className="flex items-baseline gap-1">
            <span className="label-xs">spot</span>
            <span className="font-bold tabular-nums text-flip">
              {formatPrice(map.spot)}
            </span>
          </span>
          <span className="flex items-baseline gap-1">
            <span className="label-xs">net gamma</span>
            <span
              className={`font-bold tabular-nums ${
                map.netGex >= 0 ? 'text-pos' : 'text-neg'
              }`}
            >
              {showExposure ? formatUsd(map.netGex) : '·'}
            </span>
          </span>
          <span className="flex items-baseline gap-1">
            <span className="label-xs">levels</span>
            <span className="font-bold tabular-nums text-term-text">
              {map.levelCount}
            </span>
          </span>
        </span>
        <span className="tabular-nums text-2xs text-term-faint">{asOfLabel}</span>
      </div>

      <div className="flex items-center gap-2.5 border-b border-term-line/60 px-3 py-1.5 text-2xs text-term-faint">
        <span className="w-16 shrink-0 pl-0.5">level</span>
        <span className="min-w-0 flex-1" />
        <span className="flex w-20 shrink-0 items-center justify-end gap-1">
          $ gamma <InfoTip for="wallDollar" />
        </span>
        <span className="flex w-16 shrink-0 items-center justify-end gap-1">
          from spot <InfoTip for="levelDistance" />
        </span>
      </div>

      {map.rungs.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-term-dim">
          No meaningful gamma anywhere on this chain.
        </p>
      ) : (
        <ul className="divide-y divide-term-line/60">
          {map.rungs.map((r) => (
            <RungRow
              key={r.price}
              rung={r}
              showExposure={showExposure}
              confirmed={confirmedPrices.has(r.price)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WallRow({
  wall,
  spot,
  showExposure,
  confirmed,
}: {
  wall: Wall;
  spot: number;
  /** False on thin chains — strength and the dollar figure are both GEX. */
  showExposure: boolean;
  /** True on the Standard view when this strike also appears in the volume view. */
  confirmed: boolean;
}) {
  const pct = Math.round(wall.strength * 100);
  return (
    <li className="flex flex-wrap items-center gap-2.5 px-3 py-2 text-xs tabular-nums">
      <span className="w-14 shrink-0 font-bold text-term-text">
        {formatStrike(wall.strike)}
      </span>
      <span
        className={`w-14 shrink-0 text-2xs ${
          Math.abs(wall.distancePct) < 0.5 ? 'text-flip' : 'text-term-faint'
        }`}
      >
        {wall.distancePct >= 0 ? '+' : ''}
        {wall.distancePct.toFixed(2)}%
      </span>

      {showExposure ? (
        <>
          {/* Strength as a bar, relative to the biggest wall on the same side. */}
          <span className="h-1.5 min-w-0 flex-1 bg-term-line" aria-hidden>
            <span
              className={`block h-full ${wall.gex >= 0 ? 'bg-pos' : 'bg-neg'}`}
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </span>

          <span className="w-9 shrink-0 text-right text-2xs text-term-dim">{pct}%</span>
          <span
            className={`w-20 shrink-0 text-right ${wall.gex >= 0 ? 'text-pos' : 'text-neg'}`}
          >
            {formatUsd(wall.gex)}
          </span>
          <span className="sr-only">
            {wall.strike} is {pct} percent as strong as the largest wall on this side,
            {spot > wall.strike ? ' below' : ' above'} the current price.
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1 text-right text-2xs text-term-faint">
          exposure suppressed
        </span>
      )}
      {confirmed && (
        <span className="ml-auto">
          <ConfirmedChip />
        </span>
      )}
    </li>
  );
}

/** One of the two wall lists inside the Levels box. */
function WallList({
  title,
  list,
  tone,
  tip,
  spot,
  showExposure,
  confirmedPrices,
}: {
  title: string;
  list: Wall[];
  tone: 'bull' | 'bear';
  tip: TooltipKey;
  spot: number;
  showExposure: boolean;
  /** Strikes to tag "confirmed by today's trading"; empty on the volume view. */
  confirmedPrices: Set<number>;
}) {
  return (
    <div className="border border-term-line">
      <div className="flex items-baseline justify-between gap-2 border-b border-term-line px-3 py-2">
        <span className="flex items-center gap-1.5">
          <h4 className={`label-xs ${tone === 'bull' ? 'text-bull' : 'text-bear'}`}>
            {title}
          </h4>
          <InfoTip for={tip} />
        </span>
        <span className="flex items-center gap-2 text-2xs text-term-faint">
          nearest first
          {showExposure && (
            <>
              <span className="flex items-center gap-1">
                strength <InfoTip for="wallStrength" />
              </span>
              <span className="flex items-center gap-1">
                $ <InfoTip for="wallDollar" />
              </span>
            </>
          )}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-term-dim">
          No meaningful gamma on this side.
        </p>
      ) : (
        <ul className="divide-y divide-term-line/60">
          {list.map((w) => (
            <WallRow
              key={w.strike}
              wall={w}
              spot={spot}
              showExposure={showExposure}
              confirmed={confirmedPrices.has(w.strike)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function LevelsPanel({
  walls,
  levelMap,
  spot,
  asOfLabel,
  showExposure,
  frontFlipLevel,
  frontExpiryLabel,
  activity,
  confirmedByVolume,
}: {
  walls: { above: Wall[]; below: Wall[] };
  levelMap: LevelMap;
  spot: number;
  asOfLabel: string;
  showExposure: boolean;
  /** The standard (open-interest) front-week flip, for the comparability line. */
  frontFlipLevel: number | null;
  frontExpiryLabel: string | null;
  /** The volume-weighted twin, or null when it could not be built. */
  activity: ActivityLevels | null;
  /** Standard level prices today's trading also backs. */
  confirmedByVolume: number[];
}) {
  const [view, setView] = useState<View>('walls');
  const weighting = useSyncExternalStore(
    subscribeWeighting,
    readWeighting,
    () => DEFAULT_WEIGHTING,
  );
  const choose = (next: Weighting) => writeWeighting(next);

  // The volume view can be asked for but not exist (never built), or exist but
  // be empty (nothing traded yet). Fall back to Standard for the former so the
  // switch can never strand the reader on a blank panel.
  const onActivity = weighting === 'activity' && activity !== null;
  const active = onActivity && activity ? activity : { walls, levelMap };
  const activeFrontFlip = onActivity && activity ? activity.frontFlipLevel : frontFlipLevel;
  const activeFrontLabel =
    onActivity && activity ? activity.frontExpiryLabel : frontExpiryLabel;

  // Tags are a claim that volume agrees with open interest, so they belong only
  // on the Standard view; on the volume view itself the set is empty.
  const confirmedPrices = onActivity ? new Set<number>() : new Set(confirmedByVolume);

  // Nothing traded yet: show the reason rather than empty wall lists.
  const activityEmpty = onActivity && activity !== null && !activity.available;

  return (
    <section className="space-y-2">
      {/*
        Mirrors the page's own Section header markup. The toggle has to sit
        beside the title and drive the body, so both ends of that wire live in
        this one client component rather than being split across the server
        page.
      */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-xs font-bold text-pos">2</span>
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
          Levels
        </h2>
        <InfoTip for="levelMap" />

        <div className="ml-auto flex items-center gap-1">
          {(['walls', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={v === view}
              className={`border px-2 py-0.5 text-2xs font-bold tracking-[0.08em] transition-colors ${
                v === view
                  ? 'border-pos/70 bg-pos/15 text-pos'
                  : 'border-term-line text-term-faint hover:border-pos/50 hover:text-term-dim'
              }`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {/*
        The weighting switch — the primary control, on its own full-width row.
        Standard is standing open interest, the number every other view here
        uses; Today's activity re-runs the same maths on the contracts that
        actually traded this session. Disabled when the volume pass could not be
        built at all, rather than offering a button that leads nowhere.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div
          role="group"
          aria-label="Level weighting"
          className="flex items-center gap-1"
        >
          <InfoTip for="levelWeighting" />
          {(['standard', 'activity'] as const).map((w) => {
            const disabled = w === 'activity' && activity === null;
            const selected = weighting === w && !disabled;
            return (
              <button
                key={w}
                type="button"
                disabled={disabled}
                onClick={() => choose(w)}
                aria-pressed={selected}
                title={
                  disabled
                    ? "Today's trading could not be read for this ticker."
                    : undefined
                }
                className={`border px-2.5 py-1 text-2xs font-bold tracking-[0.08em] transition-colors ${
                  selected
                    ? 'border-pos/70 bg-pos/15 text-pos'
                    : disabled
                      ? 'cursor-not-allowed border-term-line/60 text-term-faint/50'
                      : 'border-term-line text-term-faint hover:border-pos/50 hover:text-term-dim'
                }`}
              >
                {WEIGHTING_LABEL[w]}
              </button>
            );
          })}
        </div>
        <p className="min-w-0 flex-1 text-2xs leading-relaxed text-term-faint">
          {onActivity
            ? 'Based on today’s trading — the same flip, ceiling and floor, weighted by the contracts that changed hands this session rather than by everything still open.'
            : 'Based on standing open interest — every position still open on the chain. Switch to today’s activity to weight by what actually traded this session.'}
        </p>
      </div>

      <div className="panel space-y-2 p-2">
        {activityEmpty ? (
          <div className="border border-term-line px-4 py-8 text-center text-xs text-term-dim">
            <p className="text-term-text">Nothing has traded yet in today’s session.</p>
            <p className="mx-auto mt-2 max-w-md leading-relaxed">
              These levels come from the contracts that changed hands today, and
              so far none have. Check back once the market has been open for a
              while, or use the Standard view, which is built from open interest
              and is available now.
            </p>
          </div>
        ) : view === 'walls' ? (
          <>
            <WallList
              title="Walls above"
              list={active.walls.above}
              tone="bull"
              tip="wallsAbove"
              spot={spot}
              showExposure={showExposure}
              confirmedPrices={confirmedPrices}
            />
            <WallList
              title="Walls below"
              list={active.walls.below}
              tone="bear"
              tip="wallsBelow"
              spot={spot}
              showExposure={showExposure}
              confirmedPrices={confirmedPrices}
            />
          </>
        ) : (
          <LevelMapView
            map={active.levelMap}
            asOfLabel={asOfLabel}
            showExposure={showExposure}
            confirmedPrices={confirmedPrices}
          />
        )}

        {/*
          The front-week flip, always shown when there is one. Other apps
          typically quote a single front expiry, so this is the number that
          lines up with theirs — the full-chain flip above blends several
          expiries and will not.
        */}
        {!activityEmpty && activeFrontFlip !== null && (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 text-2xs leading-relaxed text-term-faint">
            <span className="label-xs text-pos/90">Front-week flip</span>
            <span className="font-bold tabular-nums text-term-text">
              {formatPrice(activeFrontFlip)}
            </span>
            <span>
              {activeFrontLabel ? `the ${activeFrontLabel} expiry on its own` : 'the nearest expiry on its own'}
              {' — the single-expiry number most other apps show, so ours lines up with theirs.'}
            </span>
            <InfoTip for="levelFrontFlip" />
          </p>
        )}

        {!showExposure ? (
          <p className="px-1 pb-1 text-2xs leading-relaxed text-flip">
            Not enough options liquidity to compute exposure reliably. The
            strikes are still listed, but their gamma figures are suppressed —
            see Tradeability below.
          </p>
        ) : view === 'walls' ? (
          <p className="flex flex-wrap items-center gap-1.5 px-1 pb-1 text-2xs leading-relaxed text-term-faint">
            <span>
              Strength is relative to the largest wall on the same side, not
              across both — a 100% bar below does not mean the floor is stronger
              than the ceiling. Amber bars are positive gamma (dealers lean
              against moves), blue is negative.
            </span>
            <InfoTip for="wallColour" />
          </p>
        ) : (
          /*
            Stated on the card, not just in the source — the same standard the
            volume profile holds itself to. Someone reading a ceiling off this
            ladder is reading a number that came out of an assumption, and they
            should be told which one before they trade against it.
          */
          <p className="flex flex-wrap items-center gap-1.5 px-1 pb-1 text-2xs leading-relaxed text-term-faint">
            <span>
              <span className="text-flip">Gamma here is an assumption.</span>{' '}
              Dealers are taken to be short every call and long every put,
              applied uniformly across the chain — the standard convention, not
              a measurement of what any dealer actually holds. Nobody outside
              those books can see the real positioning, so where the assumption
              is wrong for a name, every level on this ladder moves with it.
              Rungs are evenly spaced for legibility and are not to scale; the
              right-hand column carries the true distance. A wall is a strike
              holding at least {Math.round(active.levelMap.rule.threshold * 100)}% of
              the gamma of the biggest strike among the{' '}
              {active.levelMap.rule.neighbourhood} nearest on its own side.
            </span>
            <InfoTip for="levelNaiveGex" />
          </p>
        )}
      </div>
    </section>
  );
}
