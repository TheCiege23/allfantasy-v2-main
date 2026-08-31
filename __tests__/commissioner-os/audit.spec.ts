/**
 * Commissioner OS · T-007 acceptance, the database half.
 *
 * "A test asserts UPDATE and DELETE against AuditEvent both raise, as
 * commish_app AND as commish_migrate (the trigger is what catches the owner;
 * REVOKE alone does not)."
 *
 * 🛑 THE SECOND ROLE IS THE WHOLE TEST.
 * Asserting only as `commish_app` proves the REVOKE works and says nothing
 * about the trigger — and the REVOKE is the half that does NOT bind the table
 * owner. `commish_migrate` owns this table, so without the trigger a migration,
 * a backfill, or anything run through DIRECT_URL could rewrite audit history
 * with no error anywhere. A suite that checks one role would pass against a
 * schema with no trigger at all.
 *
 * 🛑 NOT YET RUN. Written, never executed. It needs the T-001 roles (absent —
 * measured) and the T-007 migration applied (parked in migrations-pending/),
 * against a database that is not production. Run it on a Neon branch:
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * ⚠ IT NEEDS THREE CONNECTIONS, ONE PER ROLE. Reusing one client and calling
 * SET ROLE would not test the same thing: SET ROLE from an owner keeps the
 * owner's membership, and the point is what a role that is a member of nothing
 * can do.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const APP = process.env.COMMISH_APP_URL
const MIGRATE = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL

let app: PrismaClient
let migrate: PrismaClient
let seededId: number | null = null

beforeAll(async () => {
  if (!APP || !MIGRATE) return
  app = new PrismaClient({ datasources: { db: { url: APP } } })
  migrate = new PrismaClient({ datasources: { db: { url: MIGRATE } } })
  await Promise.all([app.$connect(), migrate.$connect()])

  const rows = await migrate.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO "AuditEvent"
       ("tenantId","actorUserId","actorLabel","action","resourceType","resourceId","requestId")
     VALUES ('t-probe','u-probe','Probe','probe.write','Probe','p1','req-probe')
     RETURNING id`,
  )
  seededId = rows[0].id
})

afterAll(async () => {
  // Deliberately NOT cleaning up the seeded row: the table is append-only, so
  // there is no supported way to remove it, and reaching for DISABLE TRIGGER in
  // a test teardown is exactly the habit this design exists to prevent. Probe
  // rows are tenant-scoped to 't-probe' and cost nothing.
  await app?.$disconnect()
  await migrate?.$disconnect()
})

describe('T-007 · AuditEvent is append-only', () => {
  it('has both role connection strings configured', () => {
    expect(
      APP && MIGRATE,
      'Set COMMISH_APP_URL and COMMISH_MIGRATE_URL. Without BOTH this suite cannot distinguish the REVOKE from the trigger, which is the only thing it is for.',
    ).toBeTruthy()
  })

  it('is actually running as the roles it claims (positive control)', async () => {
    // TENANCY.md §3.1's warning, applied to this suite: if both URLs point at
    // the same role, every assertion below still passes and proves half of what
    // it says. Assert the control before trusting the result.
    const [a] = await app.$queryRawUnsafe<{ u: string }[]>(`SELECT current_user AS u`)
    const [m] = await migrate.$queryRawUnsafe<{ u: string }[]>(`SELECT current_user AS u`)
    expect(a.u).toBe('commish_app')
    expect(m.u).toBe('commish_migrate')
    expect(a.u).not.toBe(m.u)
  })

  it('the seeded row exists (positive control)', () => {
    // Without this, an INSERT that silently failed would leave every UPDATE and
    // DELETE below matching zero rows — and a statement that matches nothing
    // raises nothing, so the rejection assertions would pass vacuously.
    expect(seededId).toBeGreaterThan(0)
  })

  it('commish_app can INSERT', async () => {
    // The app must still be able to write audit, or the mutation wrapper's
    // step 8 fails every mutation. A table nobody can write to is not
    // append-only, it is read-only.
    //
    // ⚠ THE INSERT MUST RUN INSIDE A TENANT SCOPE, and originally it did not.
    // AuditEvent's tenant_isolation_write policy is
    // WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), ''))
    // so with no GUC set the check compares against NULL, fails, and the write
    // is refused:
    //
    //   ERROR: new row violates row-level security policy for table "AuditEvent"
    //
    // The first run of this suite (2026-08-31) reported that as a FAILURE of
    // "commish_app can INSERT", when it was actually RLS working exactly as
    // designed. The bug was the test connecting as commish_app without ever
    // saying which tenant it was acting for - something no real caller can do,
    // because withTenant sets the GUC as its first statement.
    //
    // set_config(..., true) is transaction-local, so it must share the
    // transaction with the INSERT - two separate $executeRawUnsafe calls can
    // land on different pooled connections and the scope would be silently lost.
    const inserted = await app.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', 't-probe', true)`)
      return tx.$executeRawUnsafe(
        `INSERT INTO "AuditEvent"
           ("tenantId","actorUserId","actorLabel","action","resourceType","resourceId","requestId")
         VALUES ('t-probe','u-probe','Probe','probe.insert','Probe','p2','req-probe')`,
      )
    })
    expect(Number(inserted)).toBeGreaterThan(0)
  })

  it('🛑 and CANNOT insert into a tenant it is not scoped to', async () => {
    // The control for the test above. Without this, "commish_app can INSERT"
    // would pass just as happily against a table with no policy at all - it
    // asserts a capability, and a capability test cannot detect a MISSING
    // restriction. Same statement, same role, different tenant in the row.
    await expect(
      app.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', 't-probe', true)`)
        return tx.$executeRawUnsafe(
          `INSERT INTO "AuditEvent"
             ("tenantId","actorUserId","actorLabel","action","resourceType","resourceId","requestId")
           VALUES ('t-other','u-probe','Probe','probe.insert','Probe','p3','req-probe-2')`,
        )
      }),
    ).rejects.toThrow()
  })

  it('commish_app cannot UPDATE', async () => {
    await expect(
      app.$executeRawUnsafe(`UPDATE "AuditEvent" SET "action" = 'tampered' WHERE id = ${seededId}`),
    ).rejects.toThrow()
  })

  it('commish_app cannot DELETE', async () => {
    await expect(
      app.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = ${seededId}`),
    ).rejects.toThrow()
  })

  it('commish_migrate — THE OWNER — cannot UPDATE either', async () => {
    // The assertion that distinguishes the trigger from the REVOKE. A REVOKE
    // does not bind a table owner, and this role owns the table.
    await expect(
      migrate.$executeRawUnsafe(
        `UPDATE "AuditEvent" SET "action" = 'tampered' WHERE id = ${seededId}`,
      ),
    ).rejects.toThrow(/append-only/i)
  })

  it('commish_migrate — THE OWNER — cannot DELETE either', async () => {
    await expect(
      migrate.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = ${seededId}`),
    ).rejects.toThrow(/append-only/i)
  })

  it('the refusal names the operation, so a log line is diagnosable', async () => {
    await expect(
      migrate.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = ${seededId}`),
    ).rejects.toThrow(/DELETE/)
  })

  it('the row is still there after every attempt', async () => {
    // Read the EFFECT, not the absence of an error. A rejection that somehow
    // still wrote would be the worst possible outcome and is invisible to
    // rejects.toThrow().
    const rows = await migrate.$queryRawUnsafe<{ action: string }[]>(
      `SELECT "action" FROM "AuditEvent" WHERE id = ${seededId}`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('probe.write')
  })

  it('commish_purge cannot delete audit rows either', async () => {
    // T-009 exempts AuditEvent from the purge so the rows survive. The purge
    // role is the one most likely to be handed a "clean up old rows" job later,
    // so it is worth pinning that the trigger stops it too.
    const purgeUrl = process.env.COMMISH_PURGE_URL
    if (!purgeUrl) {
      expect(
        purgeUrl,
        'Set COMMISH_PURGE_URL to run this. Skipping it silently would leave the one role most likely to be pointed at audit retention unchecked.',
      ).toBeTruthy()
      return
    }
    const purge = new PrismaClient({ datasources: { db: { url: purgeUrl } } })
    try {
      await expect(
        purge.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = ${seededId}`),
      ).rejects.toThrow()
    } finally {
      await purge.$disconnect()
    }
  })
})
