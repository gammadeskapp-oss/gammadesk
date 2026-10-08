import 'server-only';

/**
 * The feed's HTTP helpers — a fetch with a timeout and an honest error.
 *
 * Kept tiny and separate so the source fetchers read as "get the page, parse
 * it" with the networking out of the way, and so a non-200 turns into a thrown
 * Error the refresh records as a source failure rather than a silent empty
 * parse of an error page.
 */

const UA = 'gammadesk/1.0 (+https://www.gammadesk.app)';

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
  return (await fetchWithTimeout(url, timeoutMs)).text();
}

export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  return (await fetchWithTimeout(url, timeoutMs)).json();
}

/** A short message out of any thrown value, for the source health record. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
