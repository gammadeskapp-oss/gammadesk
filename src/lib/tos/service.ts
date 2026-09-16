import 'server-only';

import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { parseAlertSubject, isTrendScan } from './parse';
import { applyChange } from './store';

/**
 * One pass over the inbox, run by the cron route every five minutes.
 *
 * Deliberately not a long-lived poller. Vercel functions are short-lived, so a
 * `setInterval` would not survive between invocations; instead `/api/cron/
 * tos-trend` calls this once per fire, exactly as the rest of this app's
 * scheduled work runs from cron-hit routes.
 *
 * The pass: connect over TLS, open INBOX, read the unseen alerts from
 * thinkorswim oldest-first, apply the Trend-scan ones to the stored list, and
 * mark each processed message read so it is handled exactly once. Everything is
 * wrapped so a transient IMAP error is reported rather than thrown past the
 * route, and the connection is always closed.
 */

const SENDER = 'alerts@thinkorswim.com';
const MAILBOX = 'INBOX';
const LOG = '[tos-scanner]';

/**
 * Held for the duration of one pass within a single instance. Cron fires are
 * five minutes apart, so an overlap needs a pass to run that long; this guards
 * the case where it does, within one warm instance.
 */
let running = false;

export interface PollResult {
  processed: number;
  added: number;
  removed: number;
  unrecognised: number;
  ignored: number;
}

export function hasCredentials(): boolean {
  return Boolean(process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim());
}

function clientOptions(): ImapFlowOptions {
  return {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: (process.env.GMAIL_USER ?? '').trim(),
      // App passwords are shown as four space-separated groups; accept either
      // form and strip the spaces, since IMAP wants the bare 16 characters.
      pass: (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, ''),
    },
    // imapflow logs a line per command by default, which would bury the change
    // lines this feature actually wants. Keep only our own summaries.
    logger: false,
  };
}

/**
 * Run one pass. Throws if the mailbox cannot be opened; the caller records that
 * as `lastError`. Once connected, a single unreadable message does not abort
 * the pass — it is logged and skipped.
 */
export async function pollTrendInbox(): Promise<PollResult> {
  if (running) {
    return { processed: 0, added: 0, removed: 0, unrecognised: 0, ignored: 0 };
  }
  running = true;

  const result: PollResult = { processed: 0, added: 0, removed: 0, unrecognised: 0, ignored: 0 };
  const client = new ImapFlow(clientOptions());

  // Surface (do not rethrow) the async 'error' event so it cannot crash the
  // process; connect()/command rejections are handled by the try/finally.
  client.on('error', (err: unknown) => {
    console.error(`${LOG} connection error:`, err instanceof Error ? err.message : err);
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(MAILBOX);
    try {
      const uids = await client.search({ seen: false, from: SENDER }, { uid: true });
      if (!uids || uids.length === 0) return result;

      // Oldest first: UIDs are assigned in arrival order, so ascending is
      // chronological. Adds and removes must be applied in the order sent.
      for (const uid of [...uids].sort((a, b) => a - b)) {
        try {
          const message = await client.fetchOne(uid, { envelope: true }, { uid: true });
          const subject = message && message.envelope ? message.envelope.subject : undefined;
          const parsed = parseAlertSubject(subject);

          if (!parsed) {
            result.unrecognised += 1;
            console.warn(
              `${LOG} unrecognised subject from ${SENDER}: ${JSON.stringify(subject ?? '')}`,
            );
          } else if (!isTrendScan(parsed.scan)) {
            result.ignored += 1; // A real alert for another scan — ignored.
          } else {
            const { list, changed } = await applyChange(parsed.action, parsed.symbols);
            if (changed) {
              if (parsed.action === 'added') result.added += parsed.symbols.length;
              else result.removed += parsed.symbols.length;
              console.log(
                `${LOG} ${parsed.action} ${parsed.symbols.join(', ')} → ${list.symbols.length} on Trend`,
              );
            }
          }

          // Mark read only after handling, so a crash mid-loop leaves the
          // unhandled ones unseen for the next run to pick up.
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          result.processed += 1;
        } catch (err) {
          console.error(`${LOG} skipped message ${uid}:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {
      // Best effort — the next run opens a fresh connection regardless.
    });
    running = false;
  }

  return result;
}
