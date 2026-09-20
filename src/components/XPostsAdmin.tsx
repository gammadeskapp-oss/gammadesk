'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The owner-only /admin/x-posts console.
 *
 * Locked by default: it asks `/api/admin/x-posts` for the data, and a 401 (no
 * valid session cookie) means show the password box and nothing else. Once
 * unlocked it shows the pause switch, a live preview of each slot's next post,
 * and the recent post log. Uses the same unlock/lock endpoints as the TOS tab,
 * so the owner signs in once.
 */

interface Preview {
  slot: string;
  label: string;
  text: string | null;
  length: number | null;
  asOfLabel: string | null;
  checks: string[];
  reason: string | null;
}

interface LogEntry {
  at: string;
  date: string;
  slot: string;
  slotKey: string;
  text: string;
  length: number;
  outcome: 'sent' | 'skipped' | 'failed';
  reason?: string;
  tweetId?: string;
  asOfLabel?: string;
}

interface PauseState {
  paused: boolean;
  reason?: string;
  by?: string;
  at?: string;
}

interface Brief {
  date: string;
  spy: number;
  qqq: number;
  iwm: number;
  vix: number;
  topStory: string;
  earningsToday: string[];
  receivedAt?: string;
}

interface ClosingBrief {
  date: string;
  spy: number;
  spyChangePct: number;
  qqq: number;
  qqqChangePct: number;
  iwm: number;
  iwmChangePct: number;
  vix: number;
  dayStory: string;
  topMovers: string[];
  receivedAt?: string;
}

interface ImageMeta {
  date: string;
  type: 'morning' | 'closing';
  receivedAt: string;
  size: number;
  posted: boolean;
  postedAt?: string;
}

interface AdminData {
  postingEnabled: boolean;
  postingEnv?: { enabled: boolean; present: boolean; rawValue: string | null };
  pause: PauseState;
  store: { kind: string; durable: boolean; note?: string };
  brief: Brief | null;
  closingBrief: ClosingBrief | null;
  images: { morning: ImageMeta | null; closing: ImageMeta | null };
  recent: LogEntry[];
  previews: Preview[];
}

type Status = 'loading' | 'locked' | 'unlocked' | 'error';

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

const OUTCOME_STYLE: Record<LogEntry['outcome'], string> = {
  sent: 'text-bull',
  skipped: 'text-term-dim',
  failed: 'text-bear',
};

export function XPostsAdmin() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AdminData | null>(null);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/x-posts', { cache: 'no-store', credentials: 'same-origin' });
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

  const togglePause = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch('/api/admin/x-pause', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paused }),
          credentials: 'same-origin',
        });
        if (res.ok) await load();
      } catch {
        // Leave the current view; the next load will reconcile.
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (status === 'loading') {
    return <div className="panel h-40 animate-pulse" />;
  }

  if (status === 'locked') {
    return (
      <section className="panel mx-auto max-w-md px-4 py-8">
        <h2 className="text-center text-xs font-bold uppercase tracking-[0.18em] text-term-text">
          This page is private
        </h2>
        <p className="mt-2 text-center text-2xs leading-relaxed text-term-faint">
          Enter the owner password to manage X posting.
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
        Could not load the X posting console. It will retry on its own.
      </div>
    );
  }

  const { postingEnabled, postingEnv, pause, store, brief, closingBrief, images, recent, previews } = data;
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;

  return (
    <div className="space-y-4">
      {/* State + controls */}
      <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${
                postingEnabled && !pause.paused ? 'bg-pos' : 'bg-bear'
              }`}
            />
            <span className="font-bold text-term-text">
              {!postingEnabled
                ? 'Posting disabled (X_POSTING_ENABLED is not true)'
                : pause.paused
                  ? 'Paused'
                  : 'Live — posting on schedule'}
            </span>
          </div>
          {pause.paused && (
            <p className="text-2xs text-term-faint">
              {pause.reason ?? 'Paused.'} {pause.by ? `(${pause.by}` : ''}
              {pause.at ? `, ${clock(pause.at)})` : pause.by ? ')' : ''}
            </p>
          )}
          <p className="text-2xs text-term-faint">
            Log store: {store.kind}
            {store.durable ? '' : ' — not durable'}
          </p>
          {!postingEnabled && postingEnv && (
            <p className="text-2xs leading-relaxed text-flip/90">
              {postingEnv.present ? (
                <>
                  X_POSTING_ENABLED is set to{' '}
                  <code className="text-term-text">{JSON.stringify(postingEnv.rawValue)}</code>, which
                  does not read as true. Set it to <code className="text-term-text">true</code>{' '}
                  (no quotes) in Vercel → Production and redeploy.
                </>
              ) : (
                <>
                  X_POSTING_ENABLED is not set on this deployment. Add it as{' '}
                  <code className="text-term-text">true</code> in Vercel → Production
                  (check the scope is Production and the name is exact) and redeploy.
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pause.paused ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void togglePause(false)}
              className="border border-pos/60 bg-pos/12 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40"
            >
              Resume posting
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void togglePause(true)}
              className="border border-bear/60 bg-bear/12 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-bear transition-colors hover:bg-bear/20 disabled:opacity-40"
            >
              Pause posting
            </button>
          )}
          <button
            type="button"
            onClick={lock}
            className="border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text"
          >
            <span aria-hidden className="mr-1">🔒</span>
            Lock
          </button>
        </div>
      </section>

      {/* Latest Cowork briefs */}
      <section className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          <h2 className="label-xs">Latest Morning Desk brief</h2>
          {brief ? (
            <div className="panel px-3.5 py-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-term-text">{brief.date}</span>
                <span className="text-2xs text-term-faint">received {clock(brief.receivedAt)}</span>
              </div>
              <p className="mt-1.5 tabular-nums text-term-dim">
                SPY {signed(brief.spy)} · QQQ {signed(brief.qqq)} · IWM {signed(brief.iwm)} · VIX {brief.vix.toFixed(1)}
              </p>
              <p className="mt-1 text-term-text">{brief.topStory}</p>
              <p className="mt-1 text-2xs text-term-faint">
                Earnings: {brief.earningsToday.length ? brief.earningsToday.join(', ') : '—'}
              </p>
            </div>
          ) : (
            <div className="panel px-4 py-6 text-center text-xs text-term-dim">
              None yet. The morning post falls back to a live SPY/QQQ/VIX snapshot.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="label-xs">Latest Closing Bell brief</h2>
          {closingBrief ? (
            <div className="panel px-3.5 py-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-term-text">{closingBrief.date}</span>
                <span className="text-2xs text-term-faint">received {clock(closingBrief.receivedAt)}</span>
              </div>
              <p className="mt-1.5 tabular-nums text-term-dim">
                SPY {signed(closingBrief.spyChangePct)} · QQQ {signed(closingBrief.qqqChangePct)} · IWM {signed(closingBrief.iwmChangePct)} · VIX {closingBrief.vix.toFixed(1)}
              </p>
              <p className="mt-1 text-term-text">{closingBrief.dayStory}</p>
              <p className="mt-1 text-2xs text-term-faint">
                Movers: {closingBrief.topMovers.length ? closingBrief.topMovers.join(', ') : '—'}
              </p>
            </div>
          ) : (
            <div className="panel px-4 py-6 text-center text-xs text-term-dim">
              None yet. The closing post falls back to the positioning close.
            </div>
          )}
        </div>
      </section>

      {/* Today's poster images */}
      <section className="space-y-2">
        <h2 className="label-xs">Today&rsquo;s poster images (from Cowork)</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['morning', 'closing'] as const).map((type) => {
            const meta = images?.[type] ?? null;
            return (
              <div key={type} className="panel px-3.5 py-3">
                <div className="flex items-center justify-between text-2xs">
                  <span className="font-bold uppercase tracking-[0.12em] text-term-dim">{type}</span>
                  {meta ? (
                    <span className={meta.posted ? 'text-bull' : 'text-term-faint'}>
                      {meta.posted ? 'posted' : 'received'} · {kb(meta.size)}
                    </span>
                  ) : (
                    <span className="text-term-faint">none today</span>
                  )}
                </div>
                {meta ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, owner-only preview streamed from Blob; next/image would proxy-optimize it and defeat the auth.
                  <img
                    src={`/api/admin/x-image?type=${type}&date=${meta.date}&t=${encodeURIComponent(meta.receivedAt)}`}
                    alt={`${type} poster`}
                    className="mt-2 w-full rounded border border-term-line"
                  />
                ) : (
                  <p className="mt-2 text-2xs text-term-faint">
                    No image received. The post will go out text-only.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Previews */}
      <section className="space-y-2">
        <h2 className="label-xs">Next-post previews (composed live, not sent)</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {previews.map((p) => (
            <div key={p.slot} className="panel px-3.5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-bold uppercase tracking-[0.12em] text-term-dim">{p.label}</span>
                <span className={`text-2xs tabular-nums ${p.length && p.length > 280 ? 'text-bear' : 'text-term-faint'}`}>
                  {p.length ?? '—'}/280
                </span>
              </div>
              {p.text ? (
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-term-text">{p.text}</pre>
              ) : (
                <p className="mt-2 text-2xs text-bear">{p.reason ?? 'Could not compose.'}</p>
              )}
              {p.checks.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {p.checks.map((c, i) => (
                    <li key={i} className="text-2xs text-bear">⚠ {c}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Recent log */}
      <section className="space-y-2">
        <h2 className="label-xs">Recent posts</h2>
        {recent.length === 0 ? (
          <div className="panel px-4 py-8 text-center text-xs text-term-dim">
            Nothing logged yet.
          </div>
        ) : (
          <div className="panel divide-y divide-term-line/60">
            {recent.map((e, i) => (
              <div key={`${e.at}-${i}`} className="px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2 text-2xs">
                  <span className="font-bold uppercase tracking-[0.1em] text-term-dim">
                    {e.slot}
                    <span className="ml-1 font-normal text-term-faint">{e.slotKey}</span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums text-term-faint">
                    <span className={`font-bold uppercase ${OUTCOME_STYLE[e.outcome]}`}>{e.outcome}</span>
                    {clock(e.at)}
                  </span>
                </div>
                {e.text && (
                  <pre className="mt-1.5 whitespace-pre-wrap font-sans text-2xs leading-relaxed text-term-dim">{e.text}</pre>
                )}
                {e.reason && <p className="mt-1 text-2xs text-term-faint">{e.reason}</p>}
                {e.tweetId && <p className="mt-1 text-2xs text-term-faint">tweet id {e.tweetId}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
        <p>
          <span className="text-term-dim">Two switches. </span>
          The <span className="text-term-text">Pause</span> button here is the runtime
          switch — instant, no redeploy. The <span className="text-term-text">X_POSTING_ENABLED</span>{' '}
          environment variable is the master kill switch; set it to anything but{' '}
          <code>true</code> to stop all posting even if this page says live. An X auth
          or billing error auto-pauses posting and is logged above.
        </p>
      </section>
    </div>
  );
}
