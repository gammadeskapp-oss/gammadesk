'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The owner-only /admin/email-subscribers list.
 *
 * Locked by default: it asks `/api/admin/email-subscribers` for the data, and a
 * 401 (no valid session cookie) means show the password box and nothing else.
 * Uses the same unlock/lock endpoints as the TOS tab, so the owner signs in
 * once. The list itself lives in Resend — this only displays what that API
 * returns.
 */

type Status = 'loading' | 'locked' | 'unlocked' | 'error';

interface Contact {
  email: string;
  status: string;
  createdAt: string | null;
}

interface Payload {
  configured: boolean;
  missing?: string[];
  counts?: { total: number; confirmed: number; pending: number };
  contacts?: Contact[];
  error?: string;
}

export function EmailSubscribersAdmin() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<Payload | null>(null);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/email-subscribers', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setStatus('locked');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setData((await res.json()) as Payload);
      setStatus('unlocked');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the initial fetch isn't a setState synchronous with
    // the effect body (matches the other owner consoles).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const unlock = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSubmitting(true);
      setUnlockError(null);
      try {
        const res = await fetch('/api/tos/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ password }),
        });
        if (res.ok) {
          setPassword('');
          await load();
        } else if (res.status === 503) {
          setUnlockError('This page is not configured for unlock yet.');
        } else {
          setUnlockError('Wrong password.');
        }
      } catch {
        setUnlockError('Something went wrong. Try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [password, load],
  );

  if (status === 'loading') return <p className="text-xs text-term-dim">Loading…</p>;
  if (status === 'error') return <p className="text-xs text-neg">Could not load. Refresh to retry.</p>;

  if (status === 'locked') {
    return (
      <form onSubmit={unlock} className="panel max-w-sm space-y-3 p-5">
        <p className="text-sm text-term-dim">Enter the owner password to view subscribers.</p>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-term-line bg-term-bg px-3 py-2 text-sm text-term-text"
          placeholder="Password"
        />
        {unlockError && <p className="text-2xs text-neg">{unlockError}</p>}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="rounded border border-pos/50 bg-pos/10 px-4 py-2 text-sm font-bold text-pos disabled:opacity-50"
        >
          {submitting ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    );
  }

  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="panel space-y-2 p-5">
        <p className="text-sm font-bold text-flip">Email is not configured yet.</p>
        <p className="text-xs text-term-dim">
          Set these environment variables on the project: {(data.missing ?? []).join(', ') || '—'}.
        </p>
      </div>
    );
  }

  const counts = data.counts ?? { total: 0, confirmed: 0, pending: 0 };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Subscribed', value: counts.confirmed },
          { label: 'Pending', value: counts.pending },
        ].map((c) => (
          <div key={c.label} className="panel p-4">
            <div className="text-2xs font-bold uppercase tracking-[0.14em] text-term-faint">{c.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-term-text">{c.value}</div>
          </div>
        ))}
      </div>

      {data.error && <p className="text-xs text-neg">{data.error}</p>}

      <div className="panel overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-term-line text-term-faint">
              <th className="px-4 py-2 font-bold uppercase tracking-[0.1em]">Email</th>
              <th className="px-4 py-2 font-bold uppercase tracking-[0.1em]">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data.contacts ?? []).map((c) => (
              <tr key={c.email} className="border-b border-term-line/50 last:border-0">
                <td className="px-4 py-2 text-term-text">{c.email}</td>
                <td className="px-4 py-2 text-term-dim">{c.status}</td>
              </tr>
            ))}
            {(data.contacts ?? []).length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-4 text-term-dim">
                  No subscribers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
