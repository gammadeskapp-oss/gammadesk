import 'server-only';

import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseAlertClauses, isTrendScan, type TrendOp } from './parse';
import { applyEmail, readTrend } from './store';

/**
 * One pass over the inbox, run by the cron route every five minutes.
 *
 * Deliberately not a long-lived poller. Vercel functions are short-lived, so a
 * `setInterval` would not survive between invocations; instead `/api/cron/
 * tos-trend` calls this once per fire.
 *
 * ## What it does, and what it no longer relies on
 *
 * It fetches thinkorswim alerts from the last 24 hours (by sender + date, NOT
 * by the \Seen flag), skips the ones whose ID is already recorded as processed
 * in Blob, and applies the rest oldest-first. So reading or opening an alert in
 * Gmail — which flips \Seen — can no longer cause an alert to be skipped or
 * reprocessed. An alert is done only once its ID is saved to Blob; the \Seen
 * flag is set afterwards as a courtesy, and nothing depends on it.
 *
 * A single email can hold several clauses (an add and a remove together); every
 * "Trend" clause is applied in order. Everything is wrapped so a transient IMAP
 * error is reported rather than thrown past the route, and the connection is
 * always closed.
 */

const SENDER = 'alerts@thinkorswim.com';
const MAILBOX = 'INBOX';
const LOG = '[tos-scanner]';

/** How far back each run looks. 24h keeps the list self-healing after an outage. */
function lookbackMs(): number {
  const hours = Number(process.env.GAMMADESK_TOS_LOOKBACK_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

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
  saveFailed: number;
}

export function hasCredentials(): boolean {
  return Boolean(process.env['GMAIL_USER']?.trim() && process.env['GMAIL_APP_PASSWORD']?.trim());
}

function clientOptions(): ImapFlowOptions {
  return {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: (process.env['GMAIL_USER'] ?? '').trim(),
      // App passwords are shown as four space-separated groups; accept either
      // form and strip the spaces, since IMAP wants the bare 16 characters.
      pass: (process.env['GMAIL_APP_PASSWORD'] ?? '').replace(/\s+/g, ''),
    },
    // imapflow logs a line per command by default, which would bury the change
    // lines this feature actually wants. Keep only our own summaries.
    logger: false,
  };
}

/** A subject that ends without a period may have been truncated mid-clause. */
function looksTruncated(subject: string): boolean {
  return subject.trim().length > 0 && !/\.\s*$/.test(subject);
}

/**
 * Run one pass. Throws if the mailbox cannot be opened; the caller records that
 * as `lastError`. Once connected, a single unreadable message does not abort
 * the pass — it is logged and skipped.
 */
export async function pollTrendInbox(now: Date = new Date()): Promise<PollResult> {
  const result: PollResult = {
    processed: 0,
    added: 0,
    removed: 0,
    unrecognised: 0,
    ignored: 0,
    saveFailed: 0,
  };
  if (running) return result;
  running = true;

  const client = new ImapFlow(clientOptions());
  client.on('error', (err: unknown) => {
    console.error(`${LOG} connection error:`, err instanceof Error ? err.message : err);
  });

  try {
    // The set of already-handled emails, from Blob. This — not \Seen — is the
    // dedupe key.
    const processed = new Set((await readTrend()).processedIds);

    await client.connect();
    const lock = await client.getMailboxLock(MAILBOX);
    try {
      const since = new Date(now.getTime() - lookbackMs());
      const uids = await client.search({ from: SENDER, since }, { uid: true });
      if (!uids || uids.length === 0) return result;

      // Oldest first — adds and removes must be applied in the order sent.
      for (const uid of [...uids].sort((a, b) => a - b)) {
        try {
          const env = await client.fetchOne(uid, { envelope: true }, { uid: true });
          const envelope = env && env.envelope ? env.envelope : undefined;
          const id = envelope?.messageId || `uid-${uid}`;
          if (processed.has(id)) continue;

          let subject = envelope?.subject ?? '';
          let clauses = parseAlertClauses(subject);

          // Fall back to the full message (decoded subject + text body) when the
          // subject yields nothing or looks cut short.
          if (clauses.length === 0 || looksTruncated(subject)) {
            const full = await client.fetchOne(uid, { source: true }, { uid: true });
            if (full && full.source) {
              const parsed = await simpleParser(full.source);
              const fromSubject = parseAlertClauses(parsed.subject ?? subject);
              const fromBody = parseAlertClauses(parsed.text ?? '');
              // Use whichever source yielded the most clauses; the body is the
              // full text when the subject was truncated.
              const best = [fromBody, fromSubject, clauses].sort((a, b) => b.length - a.length)[0];
              clauses = best ?? clauses;
              if (parsed.subject) subject = parsed.subject;
            }
          }

          if (clauses.length === 0) {
            // Could not read it — leave it unprocessed so a future parser fix
            // can retry it, and surface it so the format can be checked.
            result.unrecognised += 1;
            console.warn(`${LOG} unrecognised alert from ${SENDER}: ${JSON.stringify(subject)}`);
            continue;
          }

          const ops: TrendOp[] = clauses
            .filter((c) => isTrendScan(c.scan))
            .map((c) => ({ action: c.action, symbols: c.symbols }));

          // Save first (records the ID, applies the ops, freshens updatedAt).
          // Only on success do we consider the email done and mark it read.
          try {
            const { list, changed } = await applyEmail(id, ops, now);
            processed.add(id);
            if (ops.length === 0) {
              result.ignored += 1; // recognised, but for another scan
            } else {
              for (const op of ops) {
                if (op.action === 'added') result.added += op.symbols.length;
                else result.removed += op.symbols.length;
              }
              console.log(
                `${LOG} applied ${ops.length} op(s) → ${list.symbols.length} on Trend` +
                  (changed ? '' : ' (no net change)'),
              );
            }
            result.processed += 1;
          } catch (saveErr) {
            // Blob write failed — do NOT mark read; the next run retries this.
            result.saveFailed += 1;
            console.error(
              `${LOG} save failed for ${id}, leaving unread for retry:`,
              saveErr instanceof Error ? saveErr.message : saveErr,
            );
            continue;
          }

          // Courtesy flag only, after a confirmed save. Failure here is harmless
          // — dedupe is by stored ID, not by \Seen.
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});
        } catch (err) {
          console.error(`${LOG} skipped message ${uid}:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
    running = false;
  }

  return result;
}
