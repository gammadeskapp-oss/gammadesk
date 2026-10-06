'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScannerRunRate } from '@/components/ScannerRunRate';
import type { DailyCount } from '@/lib/scanner/archive';

/**
 * The owner-only /admin/scanner health console.
 *
 * Locked by default behind the same session cookie as the rest of /admin. Shows
 * the morning pipeline's per-step status (run time, success/fail, attempts,
 * result line), the coverage numbers (names scored, chains missing, earnings
 * dated, contracts graded), the health-alert state, and the names-passing-per-
 * day run-rate chart moved off the public scanner page. Reads stored data only.
 */

type StepStatus = 'pending' | 'ok' | 'failed' | 'gave-up';
interface StepState {
  status: StepStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  summary: string | null;
}
interface Health {
  today: string;
  store: { kind: string; durable: boolean; note?: string };
  schedule: Record<'gamma' | 'earnings' | 'scan' | 'contracts' | 'healthDeadline', string>;
  stepOrder: Array<'gamma' | 'earnings' | 'scan' | 'contracts'>;
  pipeline: {
    date: string;
    steps: Record<string, StepState>;
    health: { alerted: boolean; alertedAt: string | null; note: string | null };
    updatedAt: string;
  } | null;
  pipelineStale: { date: string } | null;
  gamma: {
    date: string;
    refreshedAt: string;
    requested: number;
    refreshed: number;
    failures: Array<{ symbol: string; reason: string }>;
    source: string | null;
  } | null;
  earnings: { date: string; fetchedAt: string; dated: number; requested: number; source: string } | null;
  scan: {
    date: string;
    isToday: boolean;
    scannedAt: string;
    scored: number;
    universe: number;
    withGamma: number | null;
    qualityChecked: number;
    qualityTargeted: number;
    qualityFailures: string[];
    notes: string[];
  } | null;
  runRate: { counts: DailyCount[]; average: number | null };
}

const STEP_LABEL: Record<string, string> = {
  gamma: 'Gamma (dealer positioning)',
  earnings: 'Earnings dates',
  scan: 'Scan & score',
  contracts: 'Contract checks',
};

type Status = 'loading' | 'locked' | 'unlocked' | 'error';

function etTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

const STATUS_STYLE: Record<StepStatus, string> = {
  ok: 'text-pos',
  pending: 'text-term-faint',
  failed: 'text-flip',
  'gave-up': 'text-bear',
};

export function ScannerHealthAdmin() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<Health | null>(null);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/scanner-health', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setStatus('locked');
        setData(null);
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setData((await res.json()) as Health);
      setStatus('unlocked');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const submitUnlock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setUnlockError(null);
      try {
        const res = await fetch('/api/tos/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
          credentials: 'same-origin',
        });
        if (res.ok) {
          setPassword('');
          await load();
        } else if (res.status === 429) {
          setUnlockError('Too many attempts. Try again in a few minutes.');
        } else {
          setUnlockError('Wrong password.');
        }
      } catch {
        setUnlockError('Could not reach the server. Try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [password, load],
  );

  if (status === 'loading') return <div className="panel h-40 animate-pulse" />;

  if (status === 'locked') {
    return (
      <section className="panel mx-auto max-w-md px-4 py-8">
        <h2 className="text-center text-xs font-bold uppercase tracking-[0.18em] text-term-text">
          This page is private
        </h2>
        <p className="mt-2 text-center text-2xs leading-relaxed text-term-faint">
          Enter the owner password to view scanner health.
        </p>
        <form onSubmit={submitUnlock} className="mt-4 space-y-3">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className="w-full border border-term-line bg-term-bg px-3 py-2 text-xs text-term-text outline-none focus:border-pos/60"
          />
          {unlockError && <p className="text-2xs text-bear">{unlockError}</p>}
          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="w-full border border-pos/60 bg-pos/12 px-3 py-2 text-2xs font-bold uppercase tracking-[0.16em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40"
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      </section>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="panel px-4 py-10 text-center text-xs text-term-dim">
        Could not load scanner health. It will retry on its own.
      </div>
    );
  }

  const { schedule, pipeline, gamma, earnings, scan } = data;
  const chainMissing = gamma ? gamma.requested - gamma.refreshed : null;
  const chainFailPct = gamma && gamma.requested > 0 ? (gamma.failures.length / gamma.requested) * 100 : null;

  return (
    <div className="space-y-4">
      {/* Per-step status */}
      <section className="panel px-3.5 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-xs">Pipeline steps — {data.today}</h2>
          <span className="text-2xs text-term-faint">
            {pipeline ? `updated ${etTime(pipeline.updatedAt)} ET` : 'no run yet today'}
          </span>
        </div>
        <table className="mt-2.5 w-full text-xs">
          <thead>
            <tr className="text-2xs uppercase tracking-[0.12em] text-term-faint">
              <th className="py-1 text-left font-normal">Step</th>
              <th className="py-1 text-left font-normal">Due</th>
              <th className="py-1 text-left font-normal">Status</th>
              <th className="py-1 text-right font-normal">Tries</th>
              <th className="py-1 text-left font-normal">Ran</th>
              <th className="py-1 text-left font-normal">Result</th>
            </tr>
          </thead>
          <tbody>
            {data.stepOrder.map((key) => {
              const s = pipeline?.steps?.[key];
              const st: StepStatus = s?.status ?? 'pending';
              return (
                <tr key={key} className="border-t border-term-line align-top">
                  <td className="py-1.5 pr-2 font-bold text-term-text">{STEP_LABEL[key]}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-term-dim">{schedule[key]} ET</td>
                  <td className={`py-1.5 pr-2 font-bold uppercase ${STATUS_STYLE[st]}`}>{st}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-term-dim">{s?.attempts ?? 0}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-term-faint">{etTime(s?.finishedAt ?? null)}</td>
                  <td className="py-1.5 text-term-dim">
                    {s?.summary ?? '—'}
                    {s?.error && <span className="block text-2xs text-bear">{s.error}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pipeline?.health?.alerted && (
          <p className="mt-2 text-2xs text-term-faint">
            Health check: <span className="text-term-dim">{pipeline.health.note}</span>
            {pipeline.health.alertedAt ? ` (${etTime(pipeline.health.alertedAt)} ET)` : ''}
          </p>
        )}
        {!pipeline && data.pipelineStale && (
          <p className="mt-2 text-2xs text-flip">
            No pipeline run recorded for today yet. Last recorded date: {data.pipelineStale.date}.
          </p>
        )}
      </section>

      {/* Coverage snapshot */}
      <section className="panel px-3.5 py-3">
        <h2 className="label-xs">Coverage</h2>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Names scored</dt>
            <dd className="font-bold tabular-nums text-term-text">
              {scan ? `${scan.scored}/${scan.universe}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Chains</dt>
            <dd className="font-bold tabular-nums text-term-text">
              {gamma ? `${gamma.refreshed}/${gamma.requested}` : '—'}
              {chainFailPct !== null && (
                <span className={`ml-1 text-2xs ${chainFailPct > 10 ? 'text-bear' : 'text-term-faint'}`}>
                  ({chainFailPct.toFixed(0)}% missing)
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Earnings dated</dt>
            <dd className="font-bold tabular-nums text-term-text">
              {earnings ? `${earnings.dated}/${earnings.requested}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Contracts graded</dt>
            <dd className="font-bold tabular-nums text-term-text">
              {scan ? `${scan.qualityChecked}/${scan.qualityTargeted}` : '—'}
            </dd>
          </div>
        </dl>

        {gamma && gamma.failures.length > 0 && (
          <p className="mt-3 text-2xs leading-relaxed text-term-faint">
            <span className="label-xs mr-1.5">Chains missing ({chainMissing})</span>
            {gamma.failures.map((f) => f.symbol).join(', ')}
          </p>
        )}
        {scan && scan.qualityFailures.length > 0 && (
          <p className="mt-2 text-2xs leading-relaxed text-term-faint">
            <span className="label-xs mr-1.5">Contract requests failed</span>
            {scan.qualityFailures.join(', ')}
          </p>
        )}
      </section>

      {/* Names passing per day — moved off the public page */}
      <ScannerRunRate counts={data.runRate.counts} average={data.runRate.average} />

      {/* Store + source lines */}
      <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
        <h2 className="label-xs">Sources</h2>
        {gamma?.source && <p className="mt-1.5">Gamma: {gamma.source}</p>}
        {earnings?.source && <p className="mt-1">Earnings: {earnings.source}</p>}
        <p className="mt-1">
          Store: {data.store.kind}
          {data.store.durable ? '' : ' — not durable'}
          {data.store.note ? ` (${data.store.note})` : ''}
        </p>
      </section>
    </div>
  );
}
