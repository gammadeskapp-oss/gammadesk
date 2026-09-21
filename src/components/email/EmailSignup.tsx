'use client';

import { useState } from 'react';

/**
 * The free email-brief signup box for /daily and the ticker pages.
 *
 * Double opt-in: submitting only asks the server to send a confirmation email —
 * nothing is subscribed until the reader clicks the link in their inbox. The
 * box states that plainly so the "check your inbox" message is expected. Kept
 * small and phone-first to match the rest of the page.
 */
export function EmailSignup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/email/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && body.ok) {
        setState('done');
        setMessage(body.message ?? 'Check your inbox for a confirmation link.');
        setEmail('');
      } else {
        setState('error');
        setMessage(body.message ?? 'Something went wrong. Try again shortly.');
      }
    } catch {
      setState('error');
      setMessage('Something went wrong. Try again shortly.');
    }
  };

  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="text-base font-bold text-term-text">Get the morning brief by email</h2>
      <p className="mt-1 text-sm leading-relaxed text-term-dim">
        Free. Every trading day, the market map in plain English. We&rsquo;ll send one confirmation
        link first — you&rsquo;re not subscribed until you tap it.
      </p>

      {state === 'done' ? (
        <p
          role="status"
          className="mt-4 rounded border border-pos/40 bg-pos/[0.08] px-3 py-2.5 text-sm text-pos"
        >
          {message}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            aria-label="Email address"
            className="min-w-0 flex-1 rounded border border-term-line bg-term-bg px-3 py-2.5 text-sm text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={state === 'sending'}
            className="rounded border border-pos/50 bg-pos/[0.08] px-4 py-2.5 text-sm font-bold text-pos transition-colors hover:bg-pos/[0.16] disabled:opacity-50"
          >
            {state === 'sending' ? 'Sending…' : 'Sign up'}
          </button>
        </form>
      )}

      {state === 'error' && message && (
        <p role="alert" className="mt-2 text-2xs text-neg">
          {message}
        </p>
      )}

      <p className="mt-3 text-2xs text-term-faint">
        One-click unsubscribe in every email. Not financial advice.
      </p>
    </section>
  );
}
