/**
 * Commissioner OS · T-106 acceptance.
 *
 * "A suspended tenant's writes are rejected at the DATABASE, not just the
 * service layer; reads and export still work."
 *
 * The first clause cannot be demonstrated in application code — the whole claim
 * is that the refusal happens somewhere application code is not. So this
 * bypasses the domain layer entirely and issues raw statements as
 * `commish_app`, which is the only way to show that a code path nobody wrote is
 * also refused.
 *
 * 🛑 NOT YET RUN. Needs T-001's roles and T-101/T-007/T-102/T-106 applied,
 * against a database that is not production.
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const APP = process.env.COMMISH_APP_URL
const MIGRATE = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL

const LIVE = 'tenant-susp-live'
const SUSP = 'tenant-susp-suspended'

let app: PrismaClient
let migrate: PrismaClient

/** A transaction as commish_app scoped to one tenant — what withTenant does. */
async function asTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

beforeAll(async () => {
  if (!APP || !MIGRATE) return
  app = new PrismaClient({ datasources: { db: { url: APP } } })
  migrate = new PrismaClient({ datasources: { db: { url: MIGRATE } } })
  await Promise.all([app.$connect(), migrate.$connect()])

  // 🛑 CLEAN FIRST. THIS SUITE COULD ONLY PASS ONCE.
  // The tests below INSERT fixed ids (tu-live-2) and the control asserts an
  // exact TenantUser count of 1. On a second run against the same database both
  // fail — duplicate key, and count 2 — with errors that describe leftovers
  // rather than the behaviour under test. Three of the four failures on the
  // second-ever run of this suite were exactly that.
  //
  // ⚠ A SUITE THAT PASSES ONLY ON A VIRGIN DATABASE HAS NOT BEEN VERIFIED, it
  // has been observed once. Re-runnability is what makes a green run evidence,
  // and it is why this cleanup is at the START rather than in afterAll: an
  // afterAll does not run if the process dies, and the next run inherits the mess.
  //
  // Child tables first — TenantMember.tenantUserId references TenantUser.
  for (const table of ['TenantMember', 'TenantApiKey', 'TenantWebhook', 'TenantUser']) {
    await migrate.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "tenantId" IN ('${LIVE}', '${SUSP}')`,
    )
  }

  for (const [id, status] of [
    [LIVE, 'ACTIVE'],
    [SUSP, 'SUSPENDED'],
  ]) {
    await migrate.$executeRawUnsafe(
      `INSERT INTO "Tenant" (id, slug, name, status, "updatedAt")
       VALUES ('${id}', '${id}', '${id}', '${status}', now())
       ON CONFLICT (id) DO UPDATE SET status = '${status}'`,
    )
    // A row in each tenant, so the UPDATE tests below have something to match.
    await migrate.$executeRawUnsafe(
      `INSERT INTO "TenantUser" (id, "tenantId", "userId", "displayName", email, "updatedAt")
       VALUES ('tu-${id}', '${id}', 'u1', 'Probe', 'probe@example.com', now())
       ON CONFLICT (id) DO NOTHING`,
    )

    // 🛑 AND A ROW IN THE OTHER THREE TABLES, WHICH IS THE WHOLE POINT OF THE
    // `it.each` BELOW AND WAS MISSING. The comment above promised "a row in each
    // tenant"; only TenantUser got one. An UPDATE that matches ZERO rows does not
    // fire the policy's WITH CHECK — it succeeds, returning 0. So the suspension
    // assertions for TenantMember and TenantWebhook failed for a reason that had
    // nothing to do with suspension, the first time this suite was ever run
    // (2026-08-31).
    await migrate.$executeRawUnsafe(
      `INSERT INTO "TenantMember" (id, "tenantId", "tenantUserId", "updatedAt")
       VALUES ('tm-${id}', '${id}', 'tu-${id}', now())
       ON CONFLICT (id) DO NOTHING`,
    )
    await migrate.$executeRawUnsafe(
      `INSERT INTO "TenantApiKey" (id, "tenantId", prefix, hash, label, "createdBy")
       VALUES ('tk-${id}', '${id}', 'cos_test_${id}', 'x', 'probe', 'u1')
       ON CONFLICT (id) DO NOTHING`,
    )
    await migrate.$executeRawUnsafe(
      `INSERT INTO "TenantWebhook" (id, "tenantId", url, "secretRef", "updatedAt")
       VALUES ('tw-${id}', '${id}', 'https://example.invalid/hook', 'ref', now())
       ON CONFLICT (id) DO NOTHING`,
    )
  }
})

afterAll(async () => {
  await app?.$disconnect()
  await migrate?.$disconnect()
})

describe('T-106 · controls', () => {
  it('has both connection strings', () => {
    expect(APP && MIGRATE, 'Set COMMISH_APP_URL and COMMISH_MIGRATE_URL.').toBeTruthy()
  })

  it('is running as commish_app', async () => {
    // Without this, a suspended tenant's write could be refused for a reason
    // that has nothing to do with suspension — or permitted because the
    // connection is the table owner.
    const [row] = await app.$queryRawUnsafe<{ u: string }[]>(`SELECT current_user AS u`)
    expect(row.u).toBe('commish_app')
  })

  it('the two tenants really differ in status', async () => {
    const rows = await migrate.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id, status FROM "Tenant" WHERE id IN ('${LIVE}','${SUSP}') ORDER BY id`,
    )
    expect(rows.find((r) => r.id === LIVE)?.status).toBe('ACTIVE')
    expect(rows.find((r) => r.id === SUSP)?.status).toBe('SUSPENDED')
  })

  it('🛑 each tenant HAS a row to update (control for the UPDATE tests)', async () => {
    // ⚠ AN UPDATE THAT MATCHES ZERO ROWS RAISES NOTHING. WITH CHECK only fires
    // on rows a statement actually touches, so a suspension test written
    // against an empty table reports success and proves the exact opposite of
    // what it appears to.
    for (const t of [LIVE, SUSP]) {
      const rows = await migrate.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "TenantUser" WHERE "tenantId" = '${t}'`,
      )
      expect(Number(rows[0].n), `${t} has no TenantUser row`).toBe(1)
    }
  })

  it('the writable predicate exists and answers correctly', async () => {
    const rows = await migrate.$queryRawUnsafe<{ live: boolean; susp: boolean }[]>(
      `SELECT app.tenant_is_writable('${LIVE}') AS live, app.tenant_is_writable('${SUSP}') AS susp`,
    )
    expect(rows[0].live).toBe(true)
    expect(rows[0].susp).toBe(false)
  })

  it('an unknown tenant is not writable', async () => {
    // EXISTS rather than a bare SELECT, so "no such tenant" is an unambiguous
    // false rather than NULL.
    const rows = await migrate.$queryRawUnsafe<{ w: boolean }[]>(
      `SELECT app.tenant_is_writable('no-such-tenant') AS w`,
    )
    expect(rows[0].w).toBe(false)
  })
})

describe('T-106 · a LIVE tenant writes normally (positive control)', () => {
  it('can INSERT', async () => {
    // Without this the refusals below could mean "nobody can write to this
    // table", which would pass the suspension tests while breaking the product.
    await expect(
      asTenant(LIVE, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "TenantUser" (id,"tenantId","userId","displayName",email,"updatedAt")
           VALUES ('tu-live-2','${LIVE}','u2','Live Two','live2@example.com',now())`,
        ),
      ),
    ).resolves.toBeGreaterThan(0)
  })

  it('can UPDATE', async () => {
    const n = await asTenant(LIVE, (tx) =>
      tx.$executeRawUnsafe(`UPDATE "TenantUser" SET locale = 'en-GB' WHERE "tenantId" = '${LIVE}'`),
    )
    expect(n).toBeGreaterThan(0)
  })
})

describe('T-106 · 🛑 a SUSPENDED tenant cannot write, at the database', () => {
  it('INSERT is rejected', async () => {
    await expect(
      asTenant(SUSP, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "TenantUser" (id,"tenantId","userId","displayName",email,"updatedAt")
           VALUES ('tu-susp-2','${SUSP}','u2','Nope','nope@example.com',now())`,
        ),
      ),
    ).rejects.toThrow()
  })

  it('UPDATE is rejected', async () => {
    await expect(
      asTenant(SUSP, (tx) =>
        tx.$executeRawUnsafe(`UPDATE "TenantUser" SET locale = 'xx' WHERE "tenantId" = '${SUSP}'`),
      ),
    ).rejects.toThrow()
  })

  // ⚠ THE COLUMN IS PER-TABLE, AND THAT IS NOT A TIDY-UP. Every case used to
  // SET "updatedAt", but TenantApiKey HAS NO updatedAt COLUMN — so that case
  // passed by raising `column "updatedAt" does not exist`, which is an error,
  // which satisfies `.rejects.toThrow()`. It asserted nothing about suspension
  // and would have kept passing with the entire T-106 policy deleted.
  //
  // One false pass and two false failures in a three-case loop, all from the
  // same line. Assert on a column each table actually has.
  it.each([
    ['TenantMember', '"updatedAt" = now()'],
    ['TenantApiKey', `label = 'changed'`],
    ['TenantWebhook', '"updatedAt" = now()'],
  ])('%s is covered too, not just TenantUser', async (table, assignment) => {
    // The predicate is applied by a loop in the migration. A table missing
    // from that array simply stays writable, and nothing else would notice.
    await expect(
      asTenant(SUSP, (tx) =>
        tx.$executeRawUnsafe(`UPDATE "${table}" SET ${assignment} WHERE "tenantId" = '${SUSP}'`),
      ),
    ).rejects.toThrow()
  })

  // 🛑 THE CONTROL THAT MAKES THE THREE ABOVE MEAN SOMETHING. Each of them can
  // pass for two unrelated reasons: the policy refused the write, or the write
  // never matched a row. This asserts the same statement SUCCEEDS for the LIVE
  // tenant — so the rows exist and are reachable, and the only difference is
  // the tenant's status.
  it.each([
    ['TenantMember', '"updatedAt" = now()'],
    ['TenantApiKey', `label = 'changed'`],
    ['TenantWebhook', '"updatedAt" = now()'],
  ])('%s IS writable for a LIVE tenant (proves the row exists)', async (table, assignment) => {
    const n = await asTenant(LIVE, (tx) =>
      tx.$executeRawUnsafe(`UPDATE "${table}" SET ${assignment} WHERE "tenantId" = '${LIVE}'`),
    )
    expect(Number(n)).toBeGreaterThan(0)
  })

  it('the refusal comes from the POLICY, not from application code', async () => {
    // Raw SQL, no domain layer anywhere in the call. If this passes, the
    // enforcement is genuinely in the database — which is the entire criterion.
    await expect(
      asTenant(SUSP, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "TenantApiKey" (id,"tenantId",prefix,hash,label,"createdBy")
           VALUES ('ak-susp','${SUSP}','cos_live_deadbeef','h','probe','u1')`,
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i)
  })

  it('nothing was written despite the refusals', async () => {
    // Read the EFFECT. A rejection that somehow still wrote is invisible to
    // rejects.toThrow(), and this is what would catch it.
    const rows = await migrate.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "TenantUser" WHERE "tenantId" = '${SUSP}'`,
    )
    expect(Number(rows[0].n)).toBe(1)
  })
})

describe('T-106 · reads and export still work', () => {
  it('a suspended tenant can still READ its own data', async () => {
    // The predicate is in WITH CHECK, never USING — so suspension makes data
    // read-only rather than invisible.
    const rows = await asTenant(SUSP, (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM "TenantUser" WHERE "tenantId" = '${SUSP}'`),
    )
    expect((rows as unknown[]).length).toBe(1)
  })

  it('a suspended tenant can still read its Tenant row', async () => {
    const rows = await asTenant(SUSP, (tx) => tx.$queryRawUnsafe(`SELECT id, status FROM "Tenant"`))
    expect((rows as { id: string }[]).map((r) => r.id)).toEqual([SUSP])
  })

  it('🛑 audit can still be WRITTEN for a suspended tenant', async () => {
    // Deliberately excluded from the suspension check. `tenant.export` is an
    // audited action and T-004 writes its audit row inside the transaction — so
    // blocking audit writes would break the export T-106 requires to keep
    // working. A suspended tenant is exactly the one most likely to export:
    // they are leaving.
    await expect(
      asTenant(SUSP, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "AuditEvent" ("tenantId","actorUserId","actorLabel","action","resourceType","resourceId","requestId")
           VALUES ('${SUSP}','u1','Probe','tenant.export','Tenant','${SUSP}','req-export')`,
        ),
      ),
    ).resolves.toBeGreaterThan(0)
  })
})

describe('T-106 · 🛑 suspension is REVERSIBLE', () => {
  it('the Tenant row itself can still be updated while suspended', async () => {
    // The deadlock this avoids: if Tenant carried the suspension check, the
    // UPDATE that resumes a tenant would itself be blocked, and suspending
    // would be permanent — recoverable only by a manual statement as the table
    // owner.
    //
    // The database therefore makes the operator's DATA read-only; the T-104
    // matrix decides who may change status (`tenant.suspend`, PLATFORM_ADMIN
    // only). That split is stated openly rather than implied.
    const n = await asTenant(SUSP, (tx) =>
      tx.$executeRawUnsafe(`UPDATE "Tenant" SET status = 'ACTIVE' WHERE id = '${SUSP}'`),
    )
    expect(n).toBe(1)
  })

  it('and writes work again afterwards', async () => {
    await expect(
      asTenant(SUSP, (tx) =>
        tx.$executeRawUnsafe(`UPDATE "TenantUser" SET locale = 'en-US' WHERE "tenantId" = '${SUSP}'`),
      ),
    ).resolves.toBeGreaterThan(0)

    // Put it back, so re-running the file starts from the same state.
    await migrate.$executeRawUnsafe(`UPDATE "Tenant" SET status = 'SUSPENDED' WHERE id = '${SUSP}'`)
  })
})
