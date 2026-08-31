/**
 * Commissioner OS · T-001 acceptance — the four database roles.
 *
 * WHY THIS IS `.spec.ts` AND NOT `.test.ts`
 * The default vitest config includes `__tests__/**\/*.test.{ts,tsx}`. This file
 * needs a live database with the T-001 roles already provisioned, so in the
 * default suite it would be red on every machine until someone runs
 * `prisma/roles/001_provision_roles.sql`. The `.spec.ts` extension keeps it out
 * of `npm test` without editing the shared vitest config that eight other
 * sessions are running against. Run it deliberately:
 *
 *     npm run test:commissioner-os
 *
 * ⚠ IT DOES NOT SKIP ON A FAILED CONNECTION, ON PURPOSE.
 * A suite that goes green because it could not reach the database is the exact
 * failure mode TENANCY.md §3.1 describes — "isolation tests pass against a
 * control that isn't running". The only skip here is "no connection string
 * configured at all", and it says so loudly. Everything else fails.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL

// The four roles from TENANCY.md §3.1, in the order they are introduced there.
const ROLES = ['commish_migrate', 'commish_app', 'commish_platform', 'commish_purge'] as const

/**
 * Assert a role exists before asserting anything ABOUT it.
 *
 * Without this, "commish_app is a member of no other role" and "commish_app
 * owns no tables" both pass when the role does not exist at all — the query
 * returns no rows, `[]` equals `[]`, green. Measured: on an unprovisioned
 * database this suite reported 4 passed / 4 failed, and two of those passes
 * asserted nothing whatsoever.
 *
 * An absent role is not a role with no privileges. Same shape of answer,
 * opposite meaning.
 */
async function requireRole(rolname: string): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_roles WHERE rolname = $1`,
    rolname,
  )
  expect(
    Number(rows[0].n),
    `${rolname} does not exist — the assertion below would have passed vacuously. Run prisma/roles/001_provision_roles.sql.`,
  ).toBe(1)
}

let db: PrismaClient

beforeAll(async () => {
  if (!CONNECTION) return
  db = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
  await db.$connect()
})

afterAll(async () => {
  await db?.$disconnect()
})

describe('T-001 · database roles', () => {
  it('has a connection string configured', () => {
    // Not a skip. If this fails the rest of the file is meaningless, and saying
    // so once is better than eight passing tests that asserted nothing.
    expect(
      CONNECTION,
      'Set DIRECT_URL (preferred) or DATABASE_URL. Without one, none of the assertions below run — and a green suite here would mean nothing.',
    ).toBeTruthy()
  })

  it('the check itself can see roles at all (positive control)', async () => {
    // Reproduce a KNOWN POSITIVE before trusting any negative below. If the
    // catalog query is broken or the role is unprivileged, every "role X does
    // not have attribute Y" assertion passes vacuously — the query returns
    // nothing and nothing is asserted about anything.
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM pg_roles`,
    )
    expect(Number(rows[0].n)).toBeGreaterThan(0)
  })

  it('all four roles exist', async () => {
    const rows = await db.$queryRawUnsafe<{ rolname: string }[]>(
      `SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])`,
      ROLES as unknown as string[],
    )
    const found = rows.map((r) => r.rolname).sort()
    expect(
      found,
      'Run prisma/roles/001_provision_roles.sql. Until this passes the T-101 migration refuses to apply, by design.',
    ).toEqual([...ROLES].sort())
  })

  it('commish_app is neither superuser nor bypassrls', async () => {
    const rows = await db.$queryRawUnsafe<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'commish_app'`)

    // Length first: an empty result would make both assertions below pass by
    // never running. This is the same vacuous-pass trap as the control above.
    expect(rows, 'commish_app does not exist').toHaveLength(1)
    expect(rows[0].rolsuper, 'commish_app is SUPERUSER — RLS is decorative').toBe(false)
    expect(rows[0].rolbypassrls, 'commish_app has BYPASSRLS — RLS is decorative').toBe(false)
  })

  it('commish_app is not a member of any other role', async () => {
    // The SET ROLE escape. TENANCY.md §3.3: cross-tenant access is a role, and
    // it only holds if commish_app cannot become one.
    //
    // ⚠ On Neon this is the assertion most likely to fail, and the failure is
    // silent in every other respect: roles created through the Neon CONSOLE are
    // added to `neon_superuser`. Provision with the SQL script instead.
    await requireRole('commish_app')
    const rows = await db.$queryRawUnsafe<{ grantor_role: string }[]>(
      `SELECT r.rolname AS grantor_role
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
        WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'commish_app')`,
    )
    expect(
      rows.map((r) => r.grantor_role),
      'commish_app can SET ROLE into these — every one is a path around RLS',
    ).toEqual([])
  })

  it('commish_app owns no tables', async () => {
    await requireRole('commish_app')
    const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = 'commish_app'
        ORDER BY tablename`,
    )
    expect(
      rows.map((r) => r.tablename),
      'A table owner bypasses RLS unless the table is FORCE\'d. These tables would be exempt.',
    ).toEqual([])
  })

  it('commish_platform and commish_purge are also unprivileged at the role level', async () => {
    // Their access comes from T-102 policies scoped TO them, never from role
    // attributes. A BYPASSRLS here would make the policy text irrelevant while
    // leaving it in place to read as though it were doing the work.
    const rows = await db.$queryRawUnsafe<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname IN ('commish_platform', 'commish_purge')
        ORDER BY rolname`,
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.rolsuper, `${r.rolname} is SUPERUSER`).toBe(false)
      expect(r.rolbypassrls, `${r.rolname} has BYPASSRLS`).toBe(false)
    }
  })

  it('commish_migrate is not a superuser either', async () => {
    // It owns the tables, which is enough. Superuser would additionally exempt
    // it from the FORCE'd policies T-102 adds — so the `maintenance` policy
    // would become dead code that nobody could tell was dead.
    const rows = await db.$queryRawUnsafe<{ rolsuper: boolean }[]>(
      `SELECT rolsuper FROM pg_roles WHERE rolname = 'commish_migrate'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].rolsuper).toBe(false)
  })
})
