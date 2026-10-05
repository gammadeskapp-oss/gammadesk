import 'server-only';

import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';
import { POSTER_FONTS } from './fonts';
import type { PosterData } from './types';

/**
 * Render a structured poster payload to a PNG, matching the Discord poster's
 * dark card design. Flexbox only (satori has no grid). Every section is a
 * fixed-height block so the canvas height is the exact sum of what is present —
 * no clipping, no dead space — and missing sections are simply left out (never a
 * "not available" placeholder).
 *
 * Two variants:
 *   - `full`: every present section, Discord proportions (tall).
 *   - `x`:    capped at 1200×1500 for X; lower-priority sections are dropped to
 *             fit and returned in `cut` so the caller can report what was trimmed.
 */

const WIDTH = 1200;
const X_MAX_HEIGHT = 1500;
const PAD_X = 56;
const PAD_TOP = 48;
const PAD_BOTTOM = 40;
const HEADER_H = 128;
const FOOTER_H = 64;
const LABEL_H = 42;
const GAP = 26;
const CONTENT_W = WIDTH - PAD_X * 2;

const C = {
  bg: '#0b1018',
  panel: '#121b28',
  panelBorder: '#202c3d',
  rule: '#1d2938',
  title: '#f2f6fa',
  text: '#c6d1dd',
  muted: '#8695a5',
  faint: '#5c6877',
  teal: '#5fc8bf',
  up: '#45c97d',
  down: '#ef5c5c',
  accent: '#e8a24a',
  symbol: '#aebecf',
};

const fmtPrice = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const upDown = (n: number) => (n >= 0 ? C.up : C.down);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

type Block = { id: string; label: string; order: number; priority: number; height: number; node: ReactNode };

function sectionShell(label: string, note: string | undefined, bodyHeight: number, body: ReactNode): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: LABEL_H + bodyHeight, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', height: LABEL_H }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1.6, color: C.teal, textTransform: 'uppercase' }}>
          {label}
        </div>
        {note ? <div style={{ fontSize: 13, color: C.faint }}>{note}</div> : <div />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', height: bodyHeight, overflow: 'hidden' }}>{body}</div>
    </div>
  );
}

// --- section builders --------------------------------------------------------

function snapshotBlock(data: PosterData): Block {
  const cards = data.snapshot.slice(0, 5);
  const cardW = (CONTENT_W - (cards.length - 1) * 14) / cards.length;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 14 }}>
      {cards.map((s) => (
        <div
          key={s.symbol}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: cardW,
            height: 142,
            background: C.panel,
            border: `1px solid ${C.panelBorder}`,
            borderRadius: 12,
            padding: '16px 16px',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1, color: C.symbol }}>{s.symbol}</div>
          <div style={{ fontSize: 34, fontWeight: 700, color: C.title, fontFamily: 'Lora' }}>{fmtPrice(s.price)}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: s.changePct === undefined ? C.faint : upDown(s.changePct) }}>
              {s.changePct === undefined ? 'n/a' : fmtPct(s.changePct)}
            </div>
            {s.sub ? <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{clip(s.sub, 40)}</div> : <div />}
          </div>
        </div>
      ))}
    </div>
  );
  const note = data.kind === 'morning' ? 'pre-open levels' : 'at the close';
  return { id: 'snapshot', label: 'Market Snapshot', order: 0, priority: 0, height: LABEL_H + 142, node: sectionShell('Market Snapshot', note, 142, body) };
}

function vixBlock(data: PosterData): Block | null {
  const v = data.vixSwing;
  if (!v) return null;
  const bodyH = 150;
  // gauge scale: 10..35 mapped across the bar
  const lo = 10;
  const hi = 35;
  const pos = Math.max(0, Math.min(1, (v.vix - lo) / (hi - lo)));
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', height: bodyH, justifyContent: 'space-between', paddingTop: 4 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 16 }}>
        <div style={{ fontSize: 46, fontWeight: 700, color: C.accent, fontFamily: 'Lora' }}>{v.vix.toFixed(2)}</div>
        <div style={{ fontSize: 15, color: C.muted, letterSpacing: 0.5 }}>
          {`VIX · ±${v.expectedSwingPct.toFixed(2)}% EXPECTED 1-DAY SWING`}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', position: 'relative', width: CONTENT_W, height: 14, borderRadius: 7, background: 'linear-gradient(90deg,#45c97d 0%,#e8c24a 45%,#ef5c5c 100%)' }}>
          <div style={{ display: 'flex', position: 'absolute', left: Math.round(pos * (CONTENT_W - 4)), top: -4, width: 4, height: 22, background: C.title, borderRadius: 2 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', fontSize: 13, color: C.faint }}>
          <div>Calm &lt;15</div>
          <div>Watch 15–20</div>
          <div>Nervous &gt;20</div>
        </div>
      </div>
      {v.caption ? <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.35 }}>{clip(v.caption, 150)}</div> : <div />}
    </div>
  );
  return { id: 'vix', label: 'VIX Expected Swing', order: 1, priority: 1, height: LABEL_H + bodyH, node: sectionShell('VIX Expected Swing', '30-day implied', bodyH, body) };
}

function storyBlock(data: PosterData): Block | null {
  const s = data.story;
  if (!s || (!s.headline && s.points.length === 0)) return null;
  const points = s.points.slice(0, 5);
  const ROW = 58;
  const headH = s.headline ? 54 : 0;
  const bodyH = headH + points.length * ROW;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {s.headline ? (
        <div style={{ fontSize: 21, fontWeight: 700, color: C.title, height: headH, lineHeight: 1.25, overflow: 'hidden' }}>
          {clip(s.headline, 120)}
        </div>
      ) : (
        <div />
      )}
      {points.map((p, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', height: ROW, overflow: 'hidden', paddingTop: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, width: 30 }}>{String(i + 1).padStart(2, '0')}</div>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.4, width: CONTENT_W - 30 }}>{clip(p, 185)}</div>
        </div>
      ))}
    </div>
  );
  return { id: 'story', label: "Today's Story", order: 1, priority: 1, height: LABEL_H + bodyH, node: sectionShell("Today's Story", undefined, bodyH, body) };
}

function newsBlock(data: PosterData): Block | null {
  const items = (data.news ?? []).slice(0, 5);
  if (items.length === 0) return null;
  const ROW = 50;
  const bodyH = items.length * ROW;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((n, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', height: ROW, overflow: 'hidden', borderBottom: i < items.length - 1 ? `1px solid ${C.rule}` : 'none', paddingTop: 8 }}>
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.35, width: CONTENT_W - 110 }}>{clip(n.text, 135)}</div>
          <div style={{ display: 'flex', width: 110, justifyContent: 'flex-end' }}>
            {n.tag ? <div style={{ fontSize: 12, color: C.teal, background: 'rgba(95,200,191,0.12)', padding: '3px 8px', borderRadius: 6 }}>{clip(n.tag, 14)}</div> : <div />}
          </div>
        </div>
      ))}
    </div>
  );
  return { id: 'news', label: 'News & Events', order: 2, priority: 3, height: LABEL_H + bodyH, node: sectionShell('News & Events', 'ranked by likely impact', bodyH, body) };
}

function mostTalkedBlock(data: PosterData): Block | null {
  const items = (data.mostTalked ?? []).slice(0, 6);
  if (items.length === 0) return null;
  const bodyH = 40;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10, height: bodyH, overflow: 'hidden' }}>
      {items.map((t, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 999, padding: '0 14px' }}>
          <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{clip(t.name, 22)}</div>
          {t.mentions !== undefined ? <div style={{ fontSize: 12, color: C.faint }}>{String(t.mentions)}</div> : <div />}
        </div>
      ))}
    </div>
  );
  return { id: 'talk', label: 'Most Talked About', order: 3, priority: 6, height: LABEL_H + bodyH, node: sectionShell('Most Talked About', 'by mention frequency', bodyH, body) };
}

function sectorsBlock(data: PosterData): Block | null {
  const items = (data.sectors ?? []).slice(0, 8);
  if (items.length === 0) return null;
  const perRow = 4;
  const rows = Math.ceil(items.length / perRow);
  const ROW = 46;
  const bodyH = rows * ROW;
  const chipW = (CONTENT_W - (perRow - 1) * 12) / perRow;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {items.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: chipW, height: 38, background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 8, padding: '0 12px' }}>
          <div style={{ fontSize: 14, color: C.text }}>{clip(s.name, 16)}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: upDown(s.changePct) }}>{fmtPct(s.changePct)}</div>
        </div>
      ))}
    </div>
  );
  return { id: 'sectors', label: 'Sector Watch', order: 4, priority: 4, height: LABEL_H + bodyH, node: sectionShell('Sector Watch', 'group moves', bodyH, body) };
}

function moversBlock(data: PosterData): Block | null {
  const g = data.movers?.gainers ?? [];
  const l = data.movers?.losers ?? [];
  if (g.length === 0 && l.length === 0) return null;
  const rows = Math.min(5, Math.max(g.length, l.length));
  const ROW = 38;
  const bodyH = 28 + rows * ROW;
  const col = (title: string, list: typeof g, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', width: (CONTENT_W - 24) / 2 }}>
      <div style={{ fontSize: 13, color: C.faint, height: 28, letterSpacing: 0.5 }}>{title}</div>
      {list.slice(0, rows).map((m, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', height: ROW, alignItems: 'center', borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ fontSize: 16, color: C.text, fontWeight: 600 }}>{clip(m.symbol, 10)}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color }}>{fmtPct(m.changePct)}</div>
        </div>
      ))}
    </div>
  );
  const body = (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 24 }}>
      {col('TOP GAINERS', g, C.up)}
      {col('TOP LOSERS', l, C.down)}
    </div>
  );
  return { id: 'movers', label: 'Notable Movers', order: 5, priority: 2, height: LABEL_H + bodyH, node: sectionShell('Notable Movers', undefined, bodyH, body) };
}

function crossAssetBlock(data: PosterData): Block | null {
  const items = (data.crossAsset ?? []).slice(0, 5);
  if (items.length === 0) return null;
  const ROW = 56;
  const bodyH = items.length * ROW;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((a, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: ROW, overflow: 'hidden', borderBottom: i < items.length - 1 ? `1px solid ${C.rule}` : 'none', gap: 14 }}>
          <div style={{ fontSize: 15, color: C.title, fontWeight: 600, width: 150 }}>{clip(a.name, 20)}</div>
          {a.tag ? <div style={{ fontSize: 13, color: C.teal, background: 'rgba(95,200,191,0.12)', padding: '3px 8px', borderRadius: 6 }}>{clip(a.tag, 14)}</div> : <div />}
          <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.35, flex: 1 }}>{clip(a.note, 90)}</div>
        </div>
      ))}
    </div>
  );
  return { id: 'cross', label: 'Cross-Asset Reaction', order: 2, priority: 3, height: LABEL_H + bodyH, node: sectionShell('Cross-Asset Reaction', undefined, bodyH, body) };
}

function congressBlock(data: PosterData): Block | null {
  const items = (data.congress ?? []).slice(0, 5);
  if (items.length === 0) return null;
  const ROW = 44;
  const bodyH = items.length * ROW;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((c, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: ROW, borderBottom: i < items.length - 1 ? `1px solid ${C.rule}` : 'none' }}>
          <div style={{ fontSize: 14, color: C.faint, width: 36 }}>{String(i + 1).padStart(2, '0')}</div>
          <div style={{ fontSize: 16, color: C.text, fontWeight: 600, flex: 1 }}>{clip(c.name, 28)}</div>
          {c.ticker ? <div style={{ fontSize: 13, color: C.muted, width: 80 }}>{clip(c.ticker, 10)}</div> : <div style={{ width: 80 }} />}
          <div style={{ fontSize: 15, color: C.title, fontWeight: 600, width: 120, display: 'flex', justifyContent: 'flex-end' }}>{c.trades} trades</div>
        </div>
      ))}
    </div>
  );
  return { id: 'congress', label: 'Congress Watch', order: 6, priority: 7, height: LABEL_H + bodyH, node: sectionShell('Congress Watch', 'most-traded', bodyH, body) };
}

function earningsBlock(data: PosterData): Block | null {
  const items = (data.earnings ?? []).slice(0, 10);
  if (items.length === 0) return null;
  const perRow = 5;
  const rows = Math.ceil(items.length / perRow);
  const ROW = 44;
  const bodyH = rows * ROW;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.map((e, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 8, padding: '0 12px' }}>
          <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{clip(e.ticker ?? e.name, 16)}</div>
          {e.when ? <div style={{ fontSize: 11, color: C.faint }}>{clip(e.when, 10)}</div> : <div />}
        </div>
      ))}
    </div>
  );
  return { id: 'earnings', label: 'Earnings Today', order: 7, priority: 5, height: LABEL_H + bodyH, node: sectionShell('Earnings Today', 'names worth watching', bodyH, body) };
}

function strategistsBlock(data: PosterData): Block | null {
  if (!data.strategists) return null;
  const bodyH = 96;
  const body = (
    <div style={{ display: 'flex', height: bodyH, overflow: 'hidden' }}>
      <div style={{ fontSize: 16, color: C.text, lineHeight: 1.45 }}>{clip(data.strategists, 320)}</div>
    </div>
  );
  return { id: 'strategists', label: 'What Strategists Are Saying', order: 5, priority: 6, height: LABEL_H + bodyH, node: sectionShell('What Strategists Are Saying', undefined, bodyH, body) };
}

function tomorrowBlock(data: PosterData): Block | null {
  const t = data.tomorrow;
  if (!t || t.items.length === 0) return null;
  const items = t.items.slice(0, 4);
  const ROW = 34;
  const bodyH = items.length * ROW;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', height: ROW, alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', width: 6, height: 6, borderRadius: 3, background: C.teal }} />
          <div style={{ fontSize: 15, color: C.text, lineHeight: 1.35 }}>{clip(it, 120)}</div>
        </div>
      ))}
    </div>
  );
  const note = t.label ?? undefined;
  return { id: 'tomorrow', label: "Tomorrow's Watch", order: 6, priority: 5, height: LABEL_H + bodyH, node: sectionShell("Tomorrow's Watch", note, bodyH, body) };
}

// --- assembly ----------------------------------------------------------------

function buildBlocks(data: PosterData): Block[] {
  const all = (
    data.kind === 'morning'
      ? [snapshotBlock(data), vixBlock(data), newsBlock(data), mostTalkedBlock(data), sectorsBlock(data), moversBlock(data), earningsBlock(data), congressBlock(data)]
      : [snapshotBlock(data), storyBlock(data), crossAssetBlock(data), moversBlock(data), strategistsBlock(data), congressBlock(data), tomorrowBlock(data)]
  ).filter((b): b is Block => b !== null);
  return all;
}

export interface RenderResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  cut: string[];
}

export async function renderPoster(data: PosterData, variant: 'full' | 'x' = 'x', onlyId?: string): Promise<RenderResult> {
  let blocks = buildBlocks(data);
  if (onlyId) blocks = blocks.filter((b) => b.id === onlyId);
  const cut: string[] = [];

  const chromeH = PAD_TOP + HEADER_H + FOOTER_H + PAD_BOTTOM;
  const sectionCost = (b: Block) => b.height + GAP;

  if (variant === 'x') {
    const budget = X_MAX_HEIGHT - chromeH;
    // snapshot is always kept; fill the rest by priority (lower = more important)
    const ranked = [...blocks].sort((a, b) => a.priority - b.priority);
    const kept = new Set<string>();
    let used = 0;
    for (const b of ranked) {
      if (used + sectionCost(b) <= budget || b.id === 'snapshot') {
        kept.add(b.id);
        used += sectionCost(b);
      }
    }
    for (const b of blocks) if (!kept.has(b.id)) cut.push(b.label);
    blocks = blocks.filter((b) => kept.has(b.id)).sort((a, b) => a.order - b.order);
  }

  const sectionsH = blocks.reduce((sum, b) => sum + b.height + GAP, 0);
  const height = Math.round(PAD_TOP + HEADER_H + sectionsH + FOOTER_H + PAD_BOTTOM);

  const footerLeft = data.footer?.left ?? (data.kind === 'morning' ? 'Quotes: delayed · gammadesk.app' : 'gammadesk.app');
  const footerRight = data.footer?.right ?? 'Not investment advice';

  const root = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        height,
        background: C.bg,
        padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`,
        fontFamily: 'Inter',
      }}
    >
      {/* masthead */}
      <div style={{ display: 'flex', flexDirection: 'column', height: HEADER_H }}>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 40, fontWeight: 700, color: C.title, fontFamily: 'Lora' }}>{data.title}</div>
            {data.subtitle ? <div style={{ fontSize: 15, color: C.muted, marginTop: 4 }}>{clip(data.subtitle, 60)}</div> : <div />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {data.dateLabel ? <div style={{ fontSize: 16, color: C.text, fontWeight: 600 }}>{clip(data.dateLabel, 40)}</div> : <div />}
            {data.asOfLabel ? <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>{clip(data.asOfLabel, 70)}</div> : <div />}
          </div>
        </div>
        <div style={{ display: 'flex', height: 2, background: C.rule, marginTop: 20 }} />
      </div>

      {/* sections */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {blocks.map((b) => (
          <div key={b.id} style={{ display: 'flex', flexDirection: 'column', marginBottom: GAP }}>
            {b.node}
          </div>
        ))}
      </div>

      {/* footer */}
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: FOOTER_H, marginTop: 'auto', borderTop: `1px solid ${C.rule}` }}>
        <div style={{ fontSize: 13, color: C.faint }}>{clip(footerLeft, 70)}</div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, color: C.faint }}>{clip(footerRight, 40)}</div>
          <div style={{ fontSize: 13, color: C.teal, fontWeight: 700 }}>gammadesk.app</div>
        </div>
      </div>
    </div>
  );

  const img = new ImageResponse(root, {
    width: WIDTH,
    height,
    fonts: POSTER_FONTS.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });
  const bytes = new Uint8Array(await img.arrayBuffer());
  return { bytes, width: WIDTH, height, cut };
}
