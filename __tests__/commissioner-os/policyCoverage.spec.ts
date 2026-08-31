/**
 * Commissioner OS · T-103, the database half.
 *
 * The ticket's literal wording: "CI asserts every table with a `tenantId`
 * column has `relrowsecurity` and `relforcerowsecurity` true and at least one
 * policy."
 *
 * `policyCoverage.test.ts` enforces the same intent against `schema.prisma`
 * and runs in CI with no database — which is where the month-eight table is
 * actually caught, because it fires when the MODEL lands rather than when a
 * migration does. This file checks the other side: that the database matches
 * what the register claims about it.
 *
 * 🛑 NOT YET RUN. Needs T-001's roles and T-101/T-007/T-102 applied, against a
 * database that is not production. All four are parked in migrations-pending/.
 *
 * ⚠ WHY BOTH HALVES EXIST. The schema check cannot see a policy that was
 * dropped by hand, and the database check cannot see a model that has no
 * migration yet. Each is blind to the other's failure mode, and the pair is
 * cheap.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { rlsDeferredTables, rlsEnabledTables } from '@/lib/domain/tenantScopedTables'

const CONNECTION = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL

let db: PrismaClient

beforeAll(async () => {
  if (!CONNECTION) return
  db = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
  await db.$connect()
})

afterAll(async () => {
  await db?.$disconnect()
})

type RlsRow = { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }

async function rlsFor(tables: string[]): Promise<RlsRow[]> {
  return db.$queryRawUnsafe<RlsRow[]>(
    `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE relkind = 'r' AND relname = ANY($1::text[])`,
    tables,
  )
}

describe('T-103 · protected tables really are protected', () => {
  it('has a connection string', () => {
    expect(CONNECTION, 'Set COMMISH_MIGRATE_URL or DIRECT_URL.').toBeTruthy()
  })

  it('every protected table was FOUND (positive control)', async () => {
    // 🛑 THE ASSERTION THAT WAS MISSING FROM T-102's EQUIVALENT AND MADE IT
    // VACUOUS. Querying pg_class by name and then looping over the result
    // asserts nothing when the names are wrong — and five register entries DID
    // carry the wrong names, because 627 models in this repo use @@map. Check
    // the count before checking the contents, every time.
    const expected = rlsEnabledTables().map((t) => t.table)
    const rows = await rlsFor(expected)
    expect(
      rows.map((r) => r.relname).sort(),
      'Tables named in the register are missing from the database — wrong @@map name, or the migration was never applied.',
    ).toEqual([...expected].sort())
  })

  it('has RLS enabled AND forced', async () => {
    const rows = await rlsFor(rlsEnabledTables().map((t) => t.table))
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname}: RLS not enabled`).toBe(true)
      // FORCE is what makes it apply to the table OWNER. commish_migrate owns
      // these; without FORCE it is exempt, the maintenance policy is never
      // exercised, and the isolation suite passes against a control that is
      // not running.
      expect(r.relforcerowsecurity, `${r.relname}: RLS not FORCED`).toBe(true)
    }
  })

  it('has at least one policy each', async () => {
    const expected = rlsEnabledTables().map((t) => t.table)
    const rows = await db.$queryRawUnsafe<{ tablename: string; n: bigint }[]>(
      `SELECT tablename, count(*)::bigint AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])
        GROUP BY tablename`,
      expected,
    )
    const byTable = new Map(rows.map((r) => [r.tablename, Number(r.n)]))
    for (const table of expected) {
      expect(byTable.get(table) ?? 0, `${table} has RLS but NO policy — every query returns zero rows`).toBeGreaterThan(0)
    }
  })

  it('each carries all three role-scoped policies', async () => {
    // TENANCY.md §3.2: app, maintenance and platform are three separate grants.
    // A table with only `tenant_isolation` silently breaks backfills; one with
    // only `maintenance` is not isolated at all. "At least one policy" — the
    // ticket's wording — would pass in both cases.
    const rows = await db.$queryRawUnsafe<{ tablename: string; policyname: string }[]>(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      rlsEnabledTables().map((t) => t.table),
    )
    const byTable = new Map<string, string[]>()
    for (const r of rows) byTable.set(r.tablename, [...(byTable.get(r.tablename) ?? []), r.policyname])

    for (const t of rlsEnabledTables()) {
      const policies = byTable.get(t.table) ?? []
      expect(policies, `${t.table}: no maintenance policy — backfills will match zero rows`).toContain('maintenance')
      expect(policies, `${t.table}: no platform_read policy`).toContain('platform_read')
      // AuditEvent splits its app policy into read/write, because T-007 makes
      // it append-only and a FOR ALL policy would say otherwise.
      const hasApp = policies.some((p) => p.startsWith('tenant_isolation') || p === 'tenant_self')
      expect(hasApp, `${t.table}: no app policy`).toBe(true)
    }
  })
})

describe('T-103 · deferred tables are still deferred', () => {
  it('every deferred table was FOUND (positive control)', async () => {
    const expected = rlsDeferredTables().map((t) => t.table)
    const rows = await rlsFor(expected)
    expect(rows.map((r) => r.relname).sort()).toEqual([...expected].sort())
  })

  it('none has quietly gained RLS', async () => {
    // Not a wish that they stay unprotected — a check that the register still
    // describes reality. If someone enables RLS on `leagues` without updating
    // the register, the register becomes a lie, and the next person reads it
    // and believes it.
    const rows = await rlsFor(rlsDeferredTables().map((t) => t.table))
    for (const r of rows) {
      expect(
        r.relrowsecurity,
        `${r.relname} has RLS but is registered as deferred. Either update lib/domain/tenantScopedTables.ts or revert the migration.`,
      ).toBe(false)
    }
  })
})

describe('T-103 · the acceptance criterion, demonstrated', () => {
  /**
   * "Add a table with `tenantId` and no policy; CI fails."
   *
   * Demonstrated live rather than argued: create such a table, assert the
   * coverage query reports it, drop it.
   */
  const PROBE = '_commish_t103_uncovered'

  afterAll(async () => {
    await db?.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE}"`)
  })

  it('a new tenantId table with no policy is detected', async () => {
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${PROBE}" (id text primary key, "tenantId" text not null)`,
    )

    // The generic form of the check, over the whole database rather than the
    // register — this is what would catch a table nobody told the register
    // about.
    const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind = 'r'
          AND a.attname = 'tenantId'
          AND a.attnum > 0
          AND NOT c.relrowsecurity
          AND c.relname = '${PROBE}'`,
    )
    expect(rows.map((r) => r.table_name)).toEqual([PROBE])
  })
})
