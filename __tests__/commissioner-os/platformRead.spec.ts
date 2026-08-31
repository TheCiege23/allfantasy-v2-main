/**
 * Commissioner OS · T-105 acceptance, criterion 1.
 *
 * "A test proving `commish_app` cannot reach the platform policy by any means
 * available to it."
 *
 * That is a database property, not an application one — no amount of TypeScript
 * can demonstrate it, and a fake would demonstrate only that the fake was
 * written to agree.
 *
 * 🛑 NOT YET RUN. Needs T-001's roles and T-102 applied, against a database
 * that is not production.
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * ⚠ "BY ANY MEANS AVAILABLE TO IT" IS THE HARD PART OF THE CRITERION, and it
 * cannot be proved exhaustively — there is no test for "no other route exists".
 * What this does is enumerate every route that a person reaching for
 * cross-tenant data would actually try, and one that TENANCY.md §3.3 names as
 * the wrong design so a regression toward it is caught. Recorded as a bounded
 * claim rather than dressed up as a proof.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const APP = process.env.COMMISH_APP_URL
const PLATFORM = process.env.COMMISH_PLATFORM_URL
const MIGRATE = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL

const A = 'tenant-pr-a'
const B = 'tenant-pr-b'

let app: PrismaClient
let platform: PrismaClient
let migrate: PrismaClient

beforeAll(async () => {
  if (!APP || !PLATFORM || !MIGRATE) return
  app = new PrismaClient({ datasources: { db: { url: APP } } })
  platform = new PrismaClient({ datasources: { db: { url: PLATFORM } } })
  migrate = new PrismaClient({ datasources: { db: { url: MIGRATE } } })
  await Promise.all([app.$connect(), platform.$connect(), migrate.$connect()])

  for (const id of [A, B]) {
    await migrate.$executeRawUnsafe(
      `INSERT INTO "Tenant" (id, slug, name, "updatedAt")
       VALUES ('${id}', '${id}', '${id}', now()) ON CONFLICT (id) DO NOTHING`,
    )
  }
})

afterAll(async () => {
  await app?.$disconnect()
  await platform?.$disconnect()
  await migrate?.$disconnect()
})

describe('T-105 · the three roles are actually distinct (control)', () => {
  it('has all three connection strings', () => {
    expect(
      APP && PLATFORM && MIGRATE,
      'Set COMMISH_APP_URL, COMMISH_PLATFORM_URL and COMMISH_MIGRATE_URL. With fewer, this suite compares a role against itself.',
    ).toBeTruthy()
  })

  it('each connection really is its own role', async () => {
    // If two URLs point at the same role, every refusal below still passes and
    // proves nothing — the same failure TENANCY.md §3.1 warns about for the
    // isolation suite.
    const [a] = await app.$queryRawUnsafe<{ u: string }[]>(`SELECT current_user AS u`)
    const [p] = await platform.$queryRawUnsafe<{ u: string }[]>(`SELECT current_user AS u`)
    expect(a.u).toBe('commish_app')
    expect(p.u).toBe('commish_platform')
    expect(a.u).not.toBe(p.u)
  })

  it('the platform role CAN read across tenants (positive control)', async () => {
    // Establishes that cross-tenant reads work at all. Without it, every
    // "commish_app cannot" assertion could be passing because nobody can.
    const rows = await platform.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Tenant" WHERE id IN ('${A}','${B}')`,
    )
    expect(rows).toHaveLength(2)
  })
})

describe('T-105 · commish_app cannot reach the platform policy', () => {
  it('cannot SET ROLE into it', async () => {
    // The direct route. Holds only because commish_app is a member of no other
    // role — T-001's suite asserts that separately, and this is the effect.
    await expect(app.$executeRawUnsafe(`SET ROLE commish_platform`)).rejects.toThrow()
  })

  it('cannot SET SESSION AUTHORIZATION either', async () => {
    // The route people reach for when SET ROLE fails. It needs superuser.
    await expect(
      app.$executeRawUnsafe(`SET SESSION AUTHORIZATION commish_platform`),
    ).rejects.toThrow()
  })

  it('cannot grant itself membership', async () => {
    await expect(
      app.$executeRawUnsafe(`GRANT commish_platform TO commish_app`),
    ).rejects.toThrow()
  })

  it('setting app.platform_override achieves nothing', async () => {
    // 🛑 THE DESIGN TENANCY.md §3.3 REJECTS, PINNED SO A REGRESSION TOWARD IT
    // IS CAUGHT. Any role can set an app.* GUC with no privilege check — so
    // this statement SUCCEEDS and must remain worthless. The day someone gates
    // a policy on a session variable, this test is what notices.
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_override', 'on', true)`
      return tx.$queryRawUnsafe(`SELECT id FROM "Tenant"`)
    })
    expect(rows).toEqual([])
  })

  it('cannot see two tenants at once, whatever it sets app.tenant_id to', async () => {
    // ⚠ THE HONEST LIMIT OF THE GUARANTEE, ASSERTED RATHER THAN GLOSSED.
    // commish_app CAN scope itself to any single tenant it names — set_config
    // is not privileged, and the policy will honestly return that tenant's
    // rows. RLS does not protect against application code passing the wrong
    // tenantId; the session decides that, above this layer.
    //
    // What it DOES guarantee is that no single connection sees every tenant.
    // That is the difference between a bug that exposes one operator and a bug
    // that exposes the book, and it is what the separate ROLE buys.
    const seenAsA = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A}, true)`
      return tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Tenant"`)
    })
    expect(seenAsA).toEqual([{ id: A }])

    // One at a time, never both.
    expect((seenAsA as { id: string }[]).length).toBe(1)
  })

  it('cannot read PlatformGrant, which decides who is platform staff', async () => {
    // No policy for commish_app at all. The app reaches platform roles only
    // through the SECURITY DEFINER bootstrap function, which returns a role and
    // nothing else.
    const rows = await app.$queryRawUnsafe(`SELECT id FROM "PlatformGrant"`)
    expect(rows).toEqual([])
  })

  it('cannot create a policy for itself', async () => {
    // It owns nothing, and policy creation belongs to the owner.
    await expect(
      app.$executeRawUnsafe(
        `CREATE POLICY sneaky ON "Tenant" FOR SELECT TO commish_app USING (true)`,
      ),
    ).rejects.toThrow()
  })

  it('cannot disable RLS on a table', async () => {
    await expect(
      app.$executeRawUnsafe(`ALTER TABLE "Tenant" DISABLE ROW LEVEL SECURITY`),
    ).rejects.toThrow()
  })
})

describe('T-105 · the platform role is read-only', () => {
  it('cannot INSERT', async () => {
    // Its policy is FOR SELECT. A support role that can write is an admin role
    // with a reassuring name.
    await expect(
      platform.$executeRawUnsafe(
        `INSERT INTO "Tenant" (id, slug, name, "updatedAt") VALUES ('x','x','x',now())`,
      ),
    ).rejects.toThrow()
  })

  it('cannot UPDATE', async () => {
    await expect(
      platform.$executeRawUnsafe(`UPDATE "Tenant" SET name = 'x' WHERE id = '${A}'`),
    ).rejects.toThrow()
  })

  it('cannot DELETE', async () => {
    await expect(
      platform.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE id = '${A}'`),
    ).rejects.toThrow()
  })

  it('cannot modify audit rows it caused to be written', async () => {
    // T-007's trigger, from the role whose activity the operator is entitled to
    // see. Platform support does not get to edit the record of its own access.
    await expect(
      platform.$executeRawUnsafe(
        `UPDATE "AuditEvent" SET "isPlatformRead" = false WHERE "tenantId" = '${A}'`,
      ),
    ).rejects.toThrow()
  })
})
