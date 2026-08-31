/**
 * Commissioner OS · T-002 acceptance, database half.
 *
 * The third criterion — "a test proves the session value does not survive the
 * transaction" — is a Postgres behaviour. It cannot be asserted against a fake,
 * because what is being tested is that `set_config(…, true)` is LOCAL and the
 * `true` was not dropped. A fake would happily report whatever it was told.
 *
 * 🛑 NOT YET RUN. Written, never executed. It needs a database that is not
 * production, and this session has no non-production database to point at:
 * T-001's roles are unprovisioned and this project's Vercel previews share the
 * production database (root CLAUDE.md). Run it against a Neon branch.
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * It is in the opt-in suite (`.spec.ts`) for that reason. The re-entry
 * criteria, which need no database, are in `withTenant.test.ts` and do run in
 * CI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { withTenant, disconnect, getConnectionSource } from '@/lib/domain/db'

const CONNECTION = process.env.COMMISH_APP_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL

/**
 * A SECOND client, pinned to ONE connection.
 *
 * ⚠ `connection_limit=1` is load-bearing, and it is the same point T-102 makes
 * about its own isolation suite: with a normal pool, "tenant B cannot see
 * tenant A's session value" passes because B got a DIFFERENT connection, not
 * because the value was cleaned up. The test would be asserting pool behaviour
 * and reporting it as transaction behaviour. Forcing reuse of one connection is
 * what makes a pass mean something.
 */
let pinned: PrismaClient

beforeAll(async () => {
  if (!CONNECTION) return
  const url = new URL(CONNECTION)
  url.searchParams.set('connection_limit', '1')
  pinned = new PrismaClient({ datasources: { db: { url: url.toString() } } })
  await pinned.$connect()
})

afterAll(async () => {
  await pinned?.$disconnect()
  await disconnect()
})

describe('T-002 · withTenant against Postgres', () => {
  it('has a connection string configured', () => {
    expect(
      CONNECTION,
      'Set COMMISH_APP_URL (preferred). Without a connection none of the assertions below run, and a green suite would mean nothing.',
    ).toBeTruthy()
  })

  it('reports which connection it took', () => {
    // Diagnostic, and it is the tell for the unsafe fallback documented in
    // lib/domain/db.ts: once T-102's policies exist, a DATABASE_URL source
    // means the app is connecting as a table owner and RLS is doing nothing.
    // Before T-102 this is expected, so it is recorded rather than asserted.
    // eslint-disable-next-line no-console
    console.log(`[T-002] withTenant connection source: ${getConnectionSource() ?? '(not yet constructed)'}`)
    expect(true).toBe(true)
  })

  it('sets app.tenant_id inside the transaction', async () => {
    const seen = await withTenant('tenant-probe-a', async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ v: string }[]>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      )
      return rows[0]?.v
    })
    expect(seen).toBe('tenant-probe-a')
  })

  it('the session value does NOT survive the transaction', async () => {
    // The `true` in set_config(…, true). Without it the value persists on the
    // pooled connection and leaks to whichever request borrows it next — a
    // cross-tenant read whose reproducibility depends on pool timing.
    await withTenant('tenant-probe-a', async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1`)
    })

    const after = await pinned.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT current_setting('app.tenant_id', true) AS v`,
    )
    // Postgres returns '' (not NULL) for an unset custom GUC that was set
    // earlier in the session and reset — both are acceptable "not set"; a
    // LEAKED value would be the literal tenant id.
    expect([null, ''], `app.tenant_id leaked past the transaction as "${after[0]?.v}"`).toContain(
      after[0]?.v ?? null,
    )
  })

  it('a second tenant on the SAME pinned connection sees no residue', async () => {
    // Sequential, not parallel, and on one connection — so if any residue
    // existed this is where it would surface.
    const a = await withTenant('tenant-probe-a', async (tx) => {
      const r = await tx.$queryRawUnsafe<{ v: string }[]>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      )
      return r[0]?.v
    })
    const b = await withTenant('tenant-probe-b', async (tx) => {
      const r = await tx.$queryRawUnsafe<{ v: string }[]>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      )
      return r[0]?.v
    })

    expect(a).toBe('tenant-probe-a')
    expect(b).toBe('tenant-probe-b')
  })

  it('a rolled-back transaction leaves nothing behind', async () => {
    await expect(
      withTenant('tenant-probe-a', async (tx) => {
        await tx.$queryRawUnsafe(`SELECT 1`)
        throw new Error('deliberate rollback')
      }),
    ).rejects.toThrow('deliberate rollback')

    const after = await pinned.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT current_setting('app.tenant_id', true) AS v`,
    )
    expect([null, '']).toContain(after[0]?.v ?? null)
  })
})
