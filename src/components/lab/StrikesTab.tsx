'use client';

import { useRef, useState, useTransition } from 'react';
import { saveStrikesDefault } from '@/app/lab/actions';
import {
  parseTickerList,
  rowsToCsv,
  STRIKES_DEFAULT_WINDOW_DAYS,
  STRIKES_SIDES,
  type StrikesRow,
  type StrikesSide,
} from '@/lib/tasty/strikes';

/**
 * `/lab`'s Strikes tab: paste tickers, Run, and watch one row land per ticker
 * as the live feed answers. The rows stream from `/api/lab/strikes`; nothing is
 * kept between runs except the saved default list.
 */

const HEAD_CLASS =
  'whitespace-nowrap border-b border-term-edge bg-term-raised px-2 py-2 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';
const CELL_CLASS = 'border-b border-term-line/60 px-2 py-1.5 align-top tabular-nums';
const BUTTON_CLASS =
  'border border-term-line px-2 py-0.5 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos disabled:opacity-40';

const fmtInt = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtStrike = (n: number | null) => (n === null ? '—' : String(n));

export function StrikesTab({
  defaultText,
  defaultSavedAtIso,
  unavailableReason,
}: {
  defaultText: string;
  defaultSavedAtIso: string | null;
  /** Set when the run cannot happen here (not on the live feed). */
  unavailableReason: string | null;
}) {
  const [text, setText] = useState(defaultText);
  const [windowDays, setWindowDays] = useState(String(STRIKES_DEFAULT_WINDOW_DAYS));
  const [side, setSide] = useState<StrikesSide>('all');
  const [rows, setRows] = useState<StrikesRow[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(
    defaultSavedAtIso ? `Default saved ${new Date(defaultSavedAtIso).toLocaleString()}` : null,
  );
  const [saving, startSave] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  const parsed = parseTickerList(text);

  async function run() {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setError(null);
    setRows([]);
    setOrder([]);
    setStatus('Connecting to the feed…');
    const startedAt = Date.now();

    try {
      const res = await fetch('/api/lab/strikes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tickers: text, windowDays: Number(windowDays), side }),
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const message = await res.text().catch(() => '');
        let reason = message;
        try {
          reason = (JSON.parse(message) as { error?: string }).error ?? message;
        } catch {
          // Plain-text answer.
        }
        throw new Error(reason || `The run answered ${res.status}.`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let total = 0;
      let done = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += chunk.value;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as
            | { type: 'start'; tickers: string[]; rejected: string[] }
            | { type: 'row'; row: StrikesRow }
            | { type: 'error'; error: string }
            | { type: 'done'; ms: number };
          if (msg.type === 'start') {
            total = msg.tickers.length;
            setOrder(msg.tickers);
            if (msg.rejected.length) setError(`Skipped, not tickers: ${msg.rejected.join(', ')}`);
            setStatus(`0 / ${total} done`);
          } else if (msg.type === 'row') {
            done += 1;
            setRows((current) => [...current, msg.row]);
            setStatus(`${done} / ${total} done`);
          } else if (msg.type === 'error') {
            setError(msg.error);
          } else {
            setStatus(`${done} / ${total} done in ${(msg.ms / 1000).toFixed(1)} s`);
          }
        }
      }
    } catch (e) {
      if (abort.signal.aborted) {
        setStatus('Stopped.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(`Failed after ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
      }
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setRunning(false);
    }
  }

  function saveDefault() {
    startSave(async () => {
      const result = await saveStrikesDefault(text);
      setSaveNote(
        result.ok
          ? `Default updated — ${result.count} ticker${result.count === 1 ? '' : 's'}, ${new Date(result.savedAtIso).toLocaleString()}`
          : `! ${result.error}`,
      );
    });
  }

  function downloadCsv() {
    const blob = new Blob([rowsToCsv(sorted)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strikes-${side}-${windowDays}d-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Rows land in completion order; show them in the order they were pasted.
  const position = new Map(order.map((t, i) => [t, i]));
  const sorted = [...rows].sort((a, b) => (position.get(a.stock) ?? 0) - (position.get(b.stock) ?? 0));
  const pending = order.filter((t) => !rows.some((r) => r.stock === t));

  return (
    <>
      <section className="panel space-y-2.5 px-3.5 py-3" data-testid="lab-strikes">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-xs">Top strikes by open interest and volume — live dxFeed</h2>
          <span className="text-2xs text-term-faint">
            {parsed.tickers.length} ticker{parsed.tickers.length === 1 ? '' : 's'}
            {parsed.rejected.length > 0 && ` · not tickers: ${parsed.rejected.join(', ')}`}
          </span>
        </div>

        {unavailableReason && (
          <p className="border-l-2 border-l-flip px-2.5 py-1.5 text-2xs text-flip">! {unavailableReason}</p>
        )}

        <label className="block">
          <span className="label-xs">Tickers — comma- or newline-separated</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            className="mt-1 block w-full resize-y border border-term-line bg-term-bg px-2 py-1.5 font-mono text-xs text-term-text outline-none focus:border-pos/50"
          />
        </label>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-2xs">
          <label className="flex items-center gap-1.5">
            <span className="label-xs">Expiry window (days)</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              className="w-20 border border-term-line bg-term-bg px-1.5 py-0.5 tabular-nums text-term-text outline-none focus:border-pos/50"
            />
          </label>

          <div className="flex items-center gap-1" role="radiogroup" aria-label="Calls or puts">
            {STRIKES_SIDES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={side === s.id}
                onClick={() => setSide(s.id)}
                className={`border px-1.5 py-0.5 tracking-[0.08em] transition-colors ${
                  side === s.id ? 'border-pos/50 text-pos' : 'border-term-line text-term-faint hover:text-term-dim'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {running ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className={BUTTON_CLASS}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={Boolean(unavailableReason) || parsed.tickers.length === 0}
              className={`${BUTTON_CLASS} font-bold text-term-text`}
            >
              Run
            </button>
          )}
          <button type="button" onClick={saveDefault} disabled={saving} className={BUTTON_CLASS}>
            {saving ? 'Saving…' : 'Update default'}
          </button>
          <button type="button" onClick={downloadCsv} disabled={sorted.length === 0} className={BUTTON_CLASS}>
            Download CSV
          </button>
          {status && <span className="tabular-nums text-term-dim">{status}</span>}
          {saveNote && <span className="text-term-faint">{saveNote}</span>}
        </div>

        {error && <p className="text-2xs text-flip">! {error}</p>}

        <p className="text-2xs leading-relaxed text-term-faint">
          Each Run fetches every chain and re-subscribes every contract — nothing is reused from an earlier run. A
          strike&rsquo;s open interest and volume are summed across every expiration in the window (and both sides
          under All); ties go to the lower strike. Volume is today&rsquo;s, so before the open it is mostly empty.
          Personal use only: this tab never runs on the production deploy.
        </p>
      </section>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs" data-testid="lab-strikes-table">
          <thead>
            <tr>
              <th scope="col" className={HEAD_CLASS}>Stock</th>
              <th scope="col" className={HEAD_CLASS}>Top-OI strike</th>
              <th scope="col" className={HEAD_CLASS}>OI</th>
              <th scope="col" className={HEAD_CLASS}>Top-volume strike</th>
              <th scope="col" className={HEAD_CLASS}>Volume</th>
              <th scope="col" className={HEAD_CLASS}>Contracts</th>
              <th scope="col" className={HEAD_CLASS}>Note</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.stock}>
                <td className={`${CELL_CLASS} font-bold text-term-text`}>{r.stock}</td>
                {r.status === 'error' && r.topOi === null && r.topVolume === null ? (
                  <td colSpan={4} className={`${CELL_CLASS} text-flip`}>
                    skipped
                  </td>
                ) : (
                  <>
                    <td className={`${CELL_CLASS} font-bold text-term-text`}>{fmtStrike(r.topOiStrike)}</td>
                    <td className={CELL_CLASS}>{fmtInt(r.topOi)}</td>
                    <td className={`${CELL_CLASS} font-bold text-term-text`}>{fmtStrike(r.topVolumeStrike)}</td>
                    <td className={CELL_CLASS}>{fmtInt(r.topVolume)}</td>
                  </>
                )}
                <td className={`${CELL_CLASS} text-term-faint`}>{r.contracts ? fmtInt(r.contracts) : '—'}</td>
                <td className={`${CELL_CLASS} text-2xs ${r.status === 'error' ? 'text-flip' : 'text-term-faint'}`}>
                  {r.note ?? ''}
                  <span className="ml-1 text-term-faint">({(r.ms / 1000).toFixed(1)} s)</span>
                </td>
              </tr>
            ))}
            {running &&
              pending.map((t) => (
                <tr key={t}>
                  <td className={`${CELL_CLASS} text-term-faint`}>{t}</td>
                  <td colSpan={6} className={`${CELL_CLASS} text-term-faint`}>
                    waiting…
                  </td>
                </tr>
              ))}
            {sorted.length === 0 && !running && (
              <tr>
                <td colSpan={7} className={`${CELL_CLASS} text-term-faint`}>
                  No run yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
