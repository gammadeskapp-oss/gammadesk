import 'server-only';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { LAB_SESSION_COOKIE, labPasswordConfigured, verifyLabSession } from './auth';
import { labEnabled } from './flag';

/**
 * Whether `/lab` exists on this deployment at all.
 *
 * On when `GAMMADESK_LAB=1` (the old local switch) or when a password hash is
 * configured (how production turns it on). Off, every `/lab` path is a 404.
 * On, every path still needs a session — see `requireLabSession`.
 */
export function labAvailable(): boolean {
  return labEnabled() || labPasswordConfigured();
}

/**
 * The server-side check every `/lab` page and action runs before any work,
 * underneath the same check in `proxy.ts`. A missing or invalid session is a
 * redirect to the login page; an unavailable lab is a 404.
 */
export async function requireLabSession(): Promise<void> {
  if (!labAvailable()) notFound();
  const jar = await cookies();
  if (!verifyLabSession(jar.get(LAB_SESSION_COOKIE)?.value)) redirect('/lab/login');
}

/** Same check for route handlers, as a boolean so they can answer 401 / 404. */
export async function labSessionValid(): Promise<boolean> {
  const jar = await cookies();
  return verifyLabSession(jar.get(LAB_SESSION_COOKIE)?.value);
}
