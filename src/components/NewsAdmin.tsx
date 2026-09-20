'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The owner-only /admin/news console.
 *
 * Locked by default: it asks `/api/admin/news` for the data, and a 401 (no valid
 * session cookie) means show the password box and nothing else. Once unlocked it
 * shows every stored scan, newest first, with the full ranked list per day — so
 * the owner can judge the filter by seeing what it kept *and* what it dropped
 * below the public top. Uses the same unlock/lock endpoints as the TOS tab and
 * the X console, so the owner signs in once.
 */

interface PickedStory {
  ticker: string | null;
  company: string;
  headline: string;
  why: string;
  url: string;
  timestamp: string;
  source: 'edgar' | 'polygon' | 'press';
  category: string;
  score: number;
}

interface SourceReport {
  source: 'edgar' | 'polygon' | 'press';
  ok: boolean;
  count: number;
  note?: string;
}

interface Scan {
  date: string;
  scannedAt: string;
  top: PickedStory[];
  ranked: PickedStory[];
  sources: SourceReport[];
}

interface AdminData {
  store: { kind: string; durable: boolean; note?: string };
  deployedCommit: string | null;
  scans: Scan[];
}

type Status = 'loading' | 'locked' | 'unlocked' | 'error';

const SOURCE_LABEL: Record<PickedStory['source'], string> = {
  edgar: 'SEC filing',
  polygon: 'News wire',
  press: 'Press release',
};

function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' ET'
  );
}

function Row({ story, top }: { story: PickedStory; top: boolean }) {
  return (
    <div className={`flex items-start gap-3 py-2 ${top ? '' : 'opacity-70'}`}>
      <div className="w-14 shrink-0 text-right text-xs font-bold tabular-nums text-term-dim">
        {story.score.toFixed(0)}
      </div>
      <div className="w-16 shrink-0 font-mono text-xs font-bold text-term-text">
        {story.ticker ?? '—'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-term-text">{story.headline}</div>
        <div className="text-2xs text-term-dim">{story.why}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-term-faint">
          <span className="rounded bg-term-line px-1.5 py-0.5 uppercase tracking-wide">{story.category}</span>
          <span>{SOURCE_LABEL[story.source]}</span>
          <a href={story.url} target="_blank" rel="noopener noreferrer" className="text-flip hover:underline">
            source ↗
          </a>
          <span>{clock(story.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

export function NewsAdmin() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AdminData | null>(null);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/news', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setStatus('locked');
        setData(null);
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setData((await res.json()) as AdminData);
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
        } else if (res.status === 503) {
          setUnlockError('This page is not configured for unlock yet.');
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

  const lock = useCallback(async () => {
    try {
      await fetch('/api/tos/lock', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // httpOnly cookie — server clears it; just drop the view.
    }
    setData(null);
    setStatus('locked');
  }, []);

  if (status === 'loading') {
    return <p className="text-sm text-term-dim">Loading…</p>;
  }

  if (status === 'error') {
    return <p className="text-sm text-bear">Could not load the console. Refresh to try again.</p>;
  }

  if (status === 'locked') {
    return (
      <form onSubmit={submitUnlock} className="panel max-w-sm space-y-3 p-5">
        <h2 className="text-sm font-bold text-term-text">Owner sign-in</h2>
        <p className="text-xs text-term-dim">This console is private. Enter the owner password.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded border border-term-line bg-term-bg px-3 py-2 text-sm text-term-text"
          autoFocus
        />
        {unlockError && <p className="text-xs text-bear">{unlockError}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded border border-pos/50 bg-pos/[0.06] px-4 py-2 text-sm font-bold text-pos disabled:opacity-50"
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    );
  }

  const scans = data?.scans ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-2xs text-term-faint">
        <span>
          Storage: {data?.store.kind}
          {data?.store.durable ? '' : ' (not durable)'}
          {data?.deployedCommit ? ` · build ${data.deployedCommit}` : ''}
        </span>
        <button onClick={lock} className="rounded border border-term-line px-3 py-1 text-2xs text-term-dim hover:text-term-text">
          Lock
        </button>
      </div>

      {data?.store.note && (
        <p className="rounded border border-flip/40 bg-flip/[0.06] px-3 py-2 text-2xs text-flip">{data.store.note}</p>
      )}

      {scans.length === 0 && (
        <p className="text-sm text-term-dim">No scans stored yet. Run one, then reload.</p>
      )}

      {scans.map((scan) => (
        <section key={scan.date} className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-term-text">{scan.date}</h2>
            <span className="text-2xs text-term-faint">scanned {clock(scan.scannedAt)}</span>
          </div>

          <div className="mt-1 flex flex-wrap gap-3 text-2xs text-term-faint">
            {scan.sources.map((s) => (
              <span key={s.source} title={s.note ?? ''}>
                {SOURCE_LABEL[s.source]}: {s.ok ? `${s.count}` : 'failed'}
                {s.note ? ' ⚠' : ''}
              </span>
            ))}
          </div>

          {scan.ranked.length === 0 ? (
            <p className="mt-3 text-sm text-term-dim">Nothing cleared the boilerplate filter this day.</p>
          ) : (
            <div className="mt-3 divide-y divide-term-line">
              {scan.ranked.map((story, i) => (
                <Row key={`${story.url}-${i}`} story={story} top={i < scan.top.length} />
              ))}
            </div>
          )}
          <p className="mt-2 text-2xs text-term-faint">
            Rows above the fade are the {scan.top.length} that reached /daily; the rest are what the filter kept but
            ranked below the public top.
          </p>
        </section>
      ))}
    </div>
  );
}
