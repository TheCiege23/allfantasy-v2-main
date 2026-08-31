/**
 * Commissioner OS · T-102 acceptance — the tenant isolation suite.
 *
 * HANDOFF.md calls these "the most important tests in the codebase". Every
 * criterion it lists is here, in the order it lists them, and the first one is
 * first for a reason it states outright: "Without this the whole suite can pass
 * against a control that isn't running."
 *
 * 🛑 NOT YET RUN. Needs T-001's roles, T-101 + T-007 + T-102 applied, and a
 * database that is not production. All four are parked in migrations-pending/.
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * ⚠ THE DATASOURCE MUST CARRY `connection_limit=1`. Not a detail — see the
 * residue block. With a normal pool, "tenant B sees no residue" passes because
 * B got a different connection, and the suite reports pool behaviour as
 * transaction behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { rlsEnabledTables, rlsDeferredTables } from '@/lib/domain/tenantScopedTables'

const APP = process.env.COMMISH_APP_URL
const MIGRATE = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL
const PLATFORM = process.env.COMMISH_PLATFORM_URL

const A = 'tenant-iso-a'
const B = 'tenant-iso-b'

let app: PrismaClient
let migrate: PrismaClient

/** Open a transaction as commish_app scoped to one tenant, the way withTenant does. */
async function asTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

beforeAll(async () => {
  if (!APP || !MIGRATE) return

  // connection_limit=1 so the residue test cannot pass by getting a fresh
  // connection. Applied to the APP client specifically — that is the one whose
  // session state matters.
  const appUrl = new URL(APP)
  appUrl.searchParams.set('connection_limit', '1')

  app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } })
  migrate = new PrismaClient({ datasources: { db: { url: MIGRATE } } })
  await Promise.all([app.$connect(), migrate.$connect()])

  // Seed as commish_migrate — the maintenance policy is what lets it write
  // across tenants, and using it here also exercises that policy.
  for (const [id, slug] of [
    [A, 'iso-a'],
    [B, 'iso-b'],
  ]) {
    await migrate.$executeRawUnsafe(
      `INSERT INTO "Tenant" (id, slug, name, "updatedAt")
       VALUES ('${id}', '${slug}', '${slug}', now()) ON CONFLICT (id) DO NOTHING`,
    )
    // Deliberately overlapping-looking: same displayName, same email local part.
    await migrate.$executeRawUnsafe(
      `INSERT INTO "TenantUser" (id, "tenantId", "userId", "displayName", email, "updatedAt")
       VALUES ('tu-${id}', '${id}', 'shared-user', 'Same Name', 'same@example.com', now())
       ON CONFLICT (id) DO NOTHING`,
    )
    await migrate.$executeRawUnsafe(
      `INSERT INTO "AuditEvent" ("tenantId","actorUserId","actorLabel","action","resourceType","resourceId","requestId")
       VALUES ('${id}','shared-user','Same Name','probe.write','Probe','r1','req-iso')`,
    )
  }
})

afterAll(async () => {
  await app?.$disconnect()
  await migrate?.$disconnect()
})

// ─── 1 · The control, first ──────────────────────────────────────────────────

describe('T-102 · the control that everything else depends on', () => {
  it('has all connection strings', () => {
    expect(APP && MIGRATE, 'Set COMMISH_APP_URL and COMMISH_MIGRATE_URL.').toBeTruthy()
  })

  it('🛑 current_user IS commish_app', async () => {
    // HANDOFF.md puts this first and says why: "Without this the whole suite
    // can pass against a control that isn't running." If the app connects as
    // the table OWNER, or as a role with BYPASSRLS, every isolation assertion
    // below passes while proving nothing at all — because RLS is not being
    // applied to the connection making them.
    const [row] = await app.$queryRawUnsafe<{ u: string }[]>(`SELECT current_user AS u`)
    expect(
      row.u,
      'The app connection is not commish_app. Every assertion in this file is meaningless until it is.',
    ).toBe('commish_app')
  })

  it('commish_app has neither BYPASSRLS nor SUPERUSER', async () => {
    const [row] = await app.$queryRawUnsafe<{ b: boolean; s: boolean }[]>(
      `SELECT rolbypassrls AS b, rolsuper AS s FROM pg_roles WHERE rolname = current_user`,
    )
    expect(row.b).toBe(false)
    expect(row.s).toBe(false)
  })

  it('the seeded rows exist across both tenants (positive control)', async () => {
    // Without this, an isolation test proving "tenant A sees zero rows of B"
    // passes when the seed silently failed and there are no rows at all.
    const [row] = await migrate.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "TenantUser" WHERE "tenantId" IN ('${A}','${B}')`,
    )
    expect(Number(row.n)).toBe(2)
  })

  it('every table this suite relies on actually has RLS forced', async () => {
    const rows = await migrate.$queryRawUnsafe<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname = ANY($1::text[])`,
      rlsEnabledTables().map((t) => t.table),
    )
    expect(rows.length).toBe(rlsEnabledTables().length)
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname}: RLS not enabled`).toBe(true)
      // FORCE is what makes it apply to the owner. Without it commish_migrate
      // is exempt and the maintenance policy is never exercised.
      expect(r.relforcerowsecurity, `${r.relname}: RLS not FORCED`).toBe(true)
    }
  })
})

// ─── 2 · Cross-tenant reads return nothing ───────────────────────────────────

describe('T-102 · tenant A cannot see tenant B', () => {
  it('sees only its own Tenant row', async () => {
    const rows = await asTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT id FROM "Tenant"`))
    expect((rows as { id: string }[]).map((r) => r.id)).toEqual([A])
  })

  it.each(['TenantUser', 'AuditEvent'])('sees zero %s rows of the other tenant', async (table) => {
    const rows = await asTenant(A, (tx) =>
      tx.$queryRawUnsafe(`SELECT "tenantId" FROM "${table}"`),
    )
    const tenants = new Set((rows as { tenantId: string }[]).map((r) => r.tenantId))
    expect([...tenants]).toEqual([A])
    expect(tenants.has(B)).toBe(false)
  })

  it('cannot reach B by asking for it explicitly', async () => {
    // The naive expectation is that a WHERE clause naming B returns B's rows.
    // RLS ANDs its predicate in, so it returns nothing — and returning nothing
    // rather than erroring is exactly why an app-level bug here is invisible.
    const rows = await asTenant(A, (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM "TenantUser" WHERE "tenantId" = '${B}'`),
    )
    expect(rows).toEqual([])
  })

  it('cannot WRITE into another tenant', async () => {
    // The WITH CHECK half. Without it the INSERT succeeds and the row is simply
    // invisible to the session that wrote it — a cross-tenant write reporting
    // success.
    await expect(
      asTenant(A, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "TenantUser" (id,"tenantId","userId","displayName",email,"updatedAt")
           VALUES ('tu-smuggle','${B}','x','X','x@example.com',now())`,
        ),
      ),
    ).rejects.toThrow()
  })
})

// ─── 3 · The nested include — where app-level scoping fails ──────────────────

describe('T-102 · a nested include is carried by RLS, not by the extension', () => {
  it('an include does not leak the other tenant’s children', async () => {
    // 🛑 THE TEST THAT JUSTIFIES THE WHOLE ARCHITECTURE.
    // TENANCY.md §2: a Prisma extension fires on the top-level operation and
    // NOT on included relations, so app-level scoping cannot carry this. T-006
    // pins the same limitation for soft delete, where the consequence is a
    // stale row in a list. Here the identical hole is one operator reading
    // another's customer data.
    //
    // If this ever fails, the fix is NOT in application code.
    const rows = await asTenant(A, (tx) =>
      tx.$queryRawUnsafe(
        `SELECT t.id AS tenant, u."tenantId" AS child
           FROM "Tenant" t LEFT JOIN "TenantUser" u ON u."tenantId" = t.id`,
      ),
    )
    for (const r of rows as { tenant: string; child: string | null }[]) {
      expect(r.tenant).toBe(A)
      if (r.child !== null) expect(r.child).toBe(A)
    }
  })
})

// ─── 4 · No residue on a reused connection ───────────────────────────────────

describe('T-102 · connection reuse leaves no residue', () => {
  it('B does not inherit A’s scope on the same pooled connection', async () => {
    // ⚠ Meaningful ONLY because the datasource is connection_limit=1. With a
    // normal pool B would get a different connection and this would pass while
    // proving nothing — HANDOFF.md flags exactly that.
    const a = await asTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "TenantUser"`))
    const b = await asTenant(B, (tx) => tx.$queryRawUnsafe(`SELECT "tenantId" FROM "TenantUser"`))

    expect((a as { n: number }[])[0].n).toBe(1)
    expect((b as { tenantId: string }[]).every((r) => r.tenantId === B)).toBe(true)
  })

  it('a query with no scope set sees NOTHING, not everything', async () => {
    // The failure mode that matters. `set_config(..., true)` is transaction-
    // local, so outside a withTenant transaction app.tenant_id is unset,
    // nullif() makes the predicate NULL, and the policy matches no rows.
    //
    // If this ever returns rows, the app is reading unscoped — and it would do
    // so quietly, because more data is not an error.
    const rows = await app.$queryRawUnsafe(`SELECT id FROM "TenantUser"`)
    expect(rows).toEqual([])
  })

  it('an empty-string scope also sees nothing', async () => {
    // Why the policies use nullif(..., ''). set_config with '' does not unset a
    // GUC, it sets it to empty — and without nullif that would match rows whose
    // tenantId is ''.
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`
      return tx.$queryRawUnsafe(`SELECT id FROM "TenantUser"`)
    })
    expect(rows).toEqual([])
  })
})

// ─── 5 · The role boundary ───────────────────────────────────────────────────

describe('T-102 · commish_app cannot escape its role', () => {
  it('cannot SET ROLE commish_platform', async () => {
    // TENANCY.md §3.3. Cross-tenant access is a ROLE, and that only holds if
    // the app cannot become one. This is the assertion that would fail if
    // someone "helpfully" granted membership to simplify a deployment.
    await expect(app.$executeRawUnsafe(`SET ROLE commish_platform`)).rejects.toThrow()
  })

  it('cannot SET ROLE commish_migrate or commish_purge either', async () => {
    await expect(app.$executeRawUnsafe(`SET ROLE commish_migrate`)).rejects.toThrow()
    await expect(app.$executeRawUnsafe(`SET ROLE commish_purge`)).rejects.toThrow()
  })

  it('setting app.platform_override achieves nothing', async () => {
    // The design §3.3 rejects. Any role can set an app.* GUC with no privilege
    // check — so this succeeds, and must remain worthless. If a future policy
    // is ever gated on a session variable, this test is what notices.
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_override', 'on', true)`
      return tx.$queryRawUnsafe(`SELECT id FROM "TenantUser"`)
    })
    expect(rows).toEqual([])
  })

  it('cannot read PlatformGrant directly', async () => {
    // It has no policy for commish_app at all. Platform roles are reachable
    // only through the SECURITY DEFINER bootstrap function.
    const rows = await app.$queryRawUnsafe(`SELECT id FROM "PlatformGrant"`)
    expect(rows).toEqual([])
  })
})

// ─── 6 · Maintenance sees rows (the FORCE interaction) ───────────────────────

describe('T-102 · commish_migrate can still run a backfill', () => {
  it('sees rows across tenants with app.tenant_id unset', async () => {
    // 🛑 THE ONE THAT SILENTLY NO-OPS IF YOU GET IT WRONG.
    // FORCE applies RLS to the owner. Without the `maintenance` policy,
    // commish_migrate matches ZERO rows — and T-101's backfill then updates
    // nothing while its SET NOT NULL either fails or succeeds against unchanged
    // data. Nothing errors. The migration reports success.
    const rows = await migrate.$queryRawUnsafe<{ tenantId: string }[]>(
      `SELECT "tenantId" FROM "TenantUser" WHERE "tenantId" IN ('${A}','${B}')`,
    )
    expect(rows).toHaveLength(2)
  })

  it('can UPDATE across tenants', async () => {
    const n = await migrate.$executeRawUnsafe(
      `UPDATE "TenantUser" SET locale = 'en-GB' WHERE "tenantId" IN ('${A}','${B}')`,
    )
    expect(n).toBe(2)
  })
})

// ─── 7 · Platform read ───────────────────────────────────────────────────────

describe('T-102 · commish_platform reads across tenants, read-only', () => {
  it('sees both tenants', async () => {
    expect(PLATFORM, 'Set COMMISH_PLATFORM_URL — the cross-tenant path is untested without it.').toBeTruthy()
    if (!PLATFORM) return
    const p = new PrismaClient({ datasources: { db: { url: PLATFORM } } })
    try {
      const rows = await p.$queryRawUnsafe<{ tenantId: string }[]>(
        `SELECT "tenantId" FROM "TenantUser" WHERE "tenantId" IN ('${A}','${B}')`,
      )
      expect(rows).toHaveLength(2)
    } finally {
      await p.$disconnect()
    }
  })

  it('cannot write', async () => {
    // FOR SELECT only. A platform support role that can write is an admin role
    // with a reassuring name.
    if (!PLATFORM) return
    const p = new PrismaClient({ datasources: { db: { url: PLATFORM } } })
    try {
      await expect(
        p.$executeRawUnsafe(`UPDATE "TenantUser" SET locale = 'xx' WHERE "tenantId" = '${A}'`),
      ).rejects.toThrow()
    } finally {
      await p.$disconnect()
    }
  })
})

// ─── 8 · The deferred tables are honestly reported ───────────────────────────

describe('T-102 · what is deliberately NOT protected', () => {
  it('the deferred tables have no RLS, as recorded', async () => {
    // Not a failure — a decision, and this is what keeps it visible. `leagues`
    // is the important one: 1,020 AllFantasy call sites read it and none
    // connect as commish_app, so forcing RLS there is an outage, not a risk.
    const deferred = rlsDeferredTables().map((t) => t.table)
    const rows = await migrate.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname = ANY($1::text[])`,
      deferred,
    )
    // ⚠ COUNT FIRST. This loop asserted nothing for as long as the register
    // named five of these by MODEL rather than by mapped TABLE — pg_class
    // matched zero rows and `for (const r of [])` is a silent pass. T-103's
    // schema enumeration is what caught it.
    expect(
      rows.map((r) => r.relname).sort(),
      'deferred tables missing from pg_class — wrong @@map name in the register',
    ).toEqual([...deferred].sort())
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} gained RLS without the register being updated`).toBe(false)
    }
  })

  it('every deferred table carries a written reason', () => {
    for (const t of rlsDeferredTables()) {
      expect(t.note, `${t.table} is deferred with no reason recorded`).toBeTruthy()
      expect(t.note!.length).toBeGreaterThan(40)
    }
  })
})
