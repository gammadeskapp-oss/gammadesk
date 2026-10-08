'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The owner-only /admin/events health console.
 *
 * Locked behind the same session cookie as the rest of /admin. Shows, per
 * source (Fed Board, Treasury), when it last fetched cleanly, how many events
 * are held, and the most recent failure — plus today's merged list as the
 * reader would see it. Reads stored data only; it never triggers a fetch.
 */

type Status = 'loading' | 'locked' | 'unlocked' | 'error';

interface SourceHealth {
  source: string;
  ok: boolean;
  count: number;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}
interface TodayEvent {
  timeEt: string;
  timeCt?: string;
  name: string;
  importance: 'high' | 'medium' | 'low';
  who?: string;
  source?: string;
}
interface Health {
  updatedAt: string | null;
  window: { from: string; to: string };
  sources: SourceHealth[];
  sourceLabels: Record<string, string>;
  today: TodayEvent[];
  store: { kind: string; durable: boolean; note?: string };
}

function when(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleString();
}

export function EventsHealthAdmin() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<Health | null>(null);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/events-health', { cache: 'no-store', credentials: 'same-origin' });
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

  if (status === 'error') {
    return (
      <p className="panel px-4 py-6 text-center text-xs text-term-faint">
        Could not load events health. Try again shortly.
      </p>
    );
  }

  if (status === 'locked') {
    return (
      <section className="panel mx-auto max-w-md px-4 py-8">
        <h2 className="text-center text-xs font-bold uppercase tracking-[0.18em] text-term-text">
          This page is private
        </h2>
        <p className="mt-2 text-center text-2xs leading-relaxed text-term-faint">
          Enter the owner password to view events health.
        </p>
        <form onSubmit={submitUnlock} className="mt-4 space-y-3">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className="w-full border border-term-line bg-term-raised px-3 py-2 text-sm text-term-text outline-none focus:border-term-text"
          />
          {unlockError && <p className="text-2xs text-bear">{unlockError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full border border-term-line bg-term-raised px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-term-text hover:border-term-text disabled:opacity-50"
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      </section>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-xs">Feed sources</h2>
          <span className="text-2xs text-term-faint">
            last write {when(data.updatedAt)} · window {data.window.from} → {data.window.to}
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {data.sources.map((s) => (
            <li key={s.source} className="border-l border-term-line pl-3 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-term-text">
                  {data.sourceLabels[s.source] ?? s.source}
                </span>
                <span className={`text-2xs font-bold uppercase tracking-[0.12em] ${s.ok ? 'text-bull' : 'text-bear'}`}>
                  {s.ok ? 'ok' : 'failing'}
                </span>
              </div>
              <div className="mt-0.5 text-2xs text-term-faint">
                {s.count} event{s.count === 1 ? '' : 's'} held · last clean fetch {when(s.lastOkAt)}
              </div>
              {s.lastError && (
                <div className="mt-0.5 text-2xs text-bear">
                  last error ({when(s.lastErrorAt)}): {s.lastError}
                </div>
              )}
            </li>
          ))}
        </ul>
        {!data.store.durable && data.store.note && (
          <p className="mt-3 border-t border-term-line pt-2 text-2xs text-flip/90">{data.store.note}</p>
        )}
      </section>

      <section className="panel p-4">
        <h2 className="label-xs">Today, as the reader sees it</h2>
        {data.today.length === 0 ? (
          <p className="mt-2 text-xs text-term-faint">No scheduled events today.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {data.today.map((e) => (
              <li key={`${e.timeEt}-${e.name}`} className="flex items-baseline gap-2.5 text-xs">
                <span className="w-24 shrink-0 tabular-nums text-term-dim">
                  {e.timeCt ?? e.timeEt} CT
                </span>
                <span className="font-bold text-term-text">{e.name}</span>
                <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
                  {e.importance}
                  {e.source ? ` · ${e.source}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
