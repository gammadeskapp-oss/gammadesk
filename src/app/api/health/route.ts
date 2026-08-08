import { NextResponse } from 'next/server';
import { storeStatus } from '@/lib/jsonStore';

export const dynamic = 'force-dynamic';

/**
 * Configuration check.
 *
 * Reports only whether each setting is PRESENT and whether storage actually
 * works — never any value. It exists because "I added the environment
 * variable" and "the running deployment can see the environment variable" are
 * different things, and the difference is otherwise invisible from outside.
 */
export async function GET() {
  const present = (name: string) => Boolean(process.env[name]?.trim());

  const status = storeStatus();

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

  return NextResponse.json(
    {
      ok: true,
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
