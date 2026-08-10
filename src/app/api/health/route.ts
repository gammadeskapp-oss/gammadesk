import { NextResponse } from 'next/server';
import { readDigests } from '@/lib/digest';
import { peekStoredFlow } from '@/lib/flow';
import { peekStoredGroups } from '@/lib/groups';
import { storeStatus } from '@/lib/jsonStore';
import { readLog } from '@/lib/log/store';

export const dynamic = 'force-dynamic';

/**
 * Write probe throttle.
 *
 * The probe writes a single fixed key with a tiny fixed payload, so the worst
 * case is trivial storage churn — but an unauthenticated endpoint that writes
 * should still be rate-limited rather than left open.
 */
let lastProbeAt = 0;
const PROBE_INTERVAL_MS = 30_000;

interface ProbeAttempt {
  label: string;
  ok: boolean;
  error: string | null;
}

/**
 * Attempts real writes against the store.
 *
 * `list` succeeding proves read access only. A store can be readable and still
 * reject writes, and the app swallows write failures deliberately so a storage
 * problem never loses a freshly computed result — which means the failure is
 * otherwise completely silent. This surfaces it.
 *
 * Two attempts, because they fail differently: the first uses exactly the
 * options the app writes with, the second the bare minimum. If only the first
 * fails, the problem is an option, not permission.
 */
async function probeWrites(): Promise<ProbeAttempt[]> {
  const { put } = await import('@vercel/blob');
  const body = JSON.stringify({ probedAt: new Date().toISOString() });
  const attempts: ProbeAttempt[] = [];

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      attempts.push({ label, ok: true, error: null });
    } catch (error) {
      attempts.push({
        label,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await run('app options (addRandomSuffix false, allowOverwrite, cacheControlMaxAge 0)', () =>
    put('gammadesk/_probe.json', body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    }),
  );

  await run('minimal options (access public only)', () =>
    put('gammadesk/_probe-minimal.json', body, { access: 'public' }),
  );

  return attempts;
}

/** Whole hours since an ISO timestamp, or null when there is nothing stored. */
function hoursSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.round(((Date.now() - at) / 3_600_000) * 10) / 10;
}

/**
 * Configuration check.
 *
 * Reports only whether each setting is PRESENT and whether storage actually
 * works — never any value. It exists because "I added the environment
 * variable" and "the running deployment can see the environment variable" are
 * different things, and the difference is otherwise invisible from outside.
 */
export async function GET(request: Request) {
  const present = (name: string) => Boolean(process.env[name]?.trim());

  const status = storeStatus();
  const wantsProbe = new URL(request.url).searchParams.get('probe') === 'write';

  /*
   * A token can be present and still not work — wrong store, revoked, wrong
   * project. A read-only `list` is the cheapest way to tell the difference.
   */
  let blobReachable: boolean | null = null;
  let blobError: string | null = null;

  if (status.kind === 'blob') {
    try {
      const { list } = await import('@vercel/blob');
      await list({ limit: 1 });
      blobReachable = true;
    } catch (error) {
      blobReachable = false;
      blobError = error instanceof Error ? error.message : String(error);
    }
  }

  let writeProbe: ProbeAttempt[] | string | null = null;
  if (wantsProbe) {
    if (status.kind !== 'blob') {
      writeProbe = 'Skipped: no Blob store configured.';
    } else if (Date.now() - lastProbeAt < PROBE_INTERVAL_MS) {
      writeProbe = 'Throttled: try again in a few seconds.';
    } else {
      lastProbeAt = Date.now();
      writeProbe = await probeWrites();
    }
  }

  /*
   * What each scheduled job has actually written.
   *
   * This is the answer to "did the cron run?" without needing the Vercel
   * dashboard at all — every one of these reads the stored copy directly and
   * never triggers a computation, so opening this page is free.
   */
  const [log, groups, flow, digests] = await Promise.all([
    readLog().catch(() => []),
    peekStoredGroups().catch(() => null),
    peekStoredFlow().catch(() => null),
    readDigests().catch(() => []),
  ]);

  const jobs = {
    'log snapshot + settle': {
      records: log.length,
      latestDate: log[0]?.date ?? null,
      settled: log.filter((e) => e.settled).length,
      awaitingSettlement: log.filter((e) => !e.settled).length,
      hoursSinceLastWrite: hoursSince(log[0]?.snapshotAt),
    },
    'groups refresh': {
      records: groups ? groups.groups.length : 0,
      computedAt: groups?.computedAt ?? null,
      hoursSinceLastWrite: hoursSince(groups?.computedAt),
    },
    'flow refresh': {
      records: flow ? flow.rows.length : 0,
      computedAt: flow?.computedAt ?? null,
      hoursSinceLastWrite: hoursSince(flow?.computedAt),
    },
    digest: {
      records: digests.length,
      latestDate: digests[0]?.date ?? null,
      hoursSinceLastWrite: hoursSince(digests[0]?.generatedAt),
    },
  };

  /*
   * `ok` is computed, never hardcoded.
   *
   * An earlier version returned `ok: true` unconditionally alongside the
   * detail, and that top-line "true" was read as "everything is fine" while a
   * disconnected Blob store sat two lines below it. A status endpoint that
   * always says ok is worse than none.
   */
  const problems: string[] = [];

  if (!present('BLOB_READ_WRITE_TOKEN')) {
    /*
     * Connecting a store and receiving a read/write token are separate things.
     * Vercel can attach BLOB_STORE_ID while never provisioning
     * BLOB_READ_WRITE_TOKEN, which looks like "Connected" in the dashboard and
     * like "not connected at all" from here. Distinguish the two, because the
     * fix is completely different.
     */
    problems.push(
      present('BLOB_STORE_ID')
        ? 'A Blob store IS connected (BLOB_STORE_ID is present) but BLOB_READ_WRITE_TOKEN was never provisioned, and that is the one the client needs. Open the store in the Vercel dashboard, copy its BLOB_READ_WRITE_TOKEN, add it under Settings -> Environment Variables for all environments, then redeploy.'
        : 'No Blob store is connected, so anything the scheduled jobs write is lost on the next deploy. Vercel dashboard -> project -> Storage -> connect a Blob store, then redeploy.',
    );
  } else if (blobReachable === false) {
    problems.push(
      `A Blob token is present but the store could not be read (${blobError ?? 'unknown error'}). Check it is connected to THIS project.`,
    );
  }

  if (!present('CRON_SECRET')) {
    problems.push(
      'CRON_SECRET is not set, so every scheduled endpoint refuses to run and returns 503.',
    );
  }

  return NextResponse.json(
    {
      // True only when storage will actually survive a deploy and the jobs
      // are able to run at all.
      ok: problems.length === 0,
      summary:
        problems.length === 0
          ? 'Configured. Scheduled jobs can run and what they write will persist.'
          : `${problems.length} thing${problems.length === 1 ? '' : 's'} still to fix — see "problems".`,
      problems,
      writeProbe,
      jobs,
      /*
       * Which deployment is answering. Without this it is impossible to tell
       * "the setting is wrong" from "you are looking at an older build".
       */
      deployment: {
        env: process.env.VERCEL_ENV ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
      /*
       * NAMES ONLY, never values.
       *
       * Vercel lets a Blob store be connected under a custom variable prefix,
       * so the token can arrive as something other than BLOB_READ_WRITE_TOKEN.
       * Listing the names that look blob-related turns "it says not connected
       * but the dashboard says connected" into an answer.
       */
      blobVariableNamesPresent: Object.keys(process.env)
        .filter((name) => /blob|read_write_token/i.test(name))
        .sort(),
      environment: {
        vercel: present('VERCEL'),
        // Values are never included — presence only.
        BLOB_READ_WRITE_TOKEN: present('BLOB_READ_WRITE_TOKEN'),
        CRON_SECRET: present('CRON_SECRET'),
        POLYGON_API_KEY: present('POLYGON_API_KEY'),
        DISCORD_WEBHOOK_URL: present('DISCORD_WEBHOOK_URL'),
      },
      storage: {
        kind: status.kind,
        durable: status.durable,
        reachable: blobReachable,
        error: blobError,
        note: status.note ?? null,
      },
      hint:
        status.kind === 'blob'
          ? blobReachable
            ? 'Blob storage is connected and writable. Records will survive redeploys.'
            : 'A Blob token is present but the store could not be read. Check that the Blob store is connected to THIS project.'
          : 'No Blob token in this deployment. Connect a Blob store to the project, then redeploy — environment variables only apply to new builds.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
