/**
 * Commissioner OS · T-102 — the tenant-scoped table register.
 *
 * The register is read by the T-102 migration's policy loop, the isolation
 * suite, and T-103's coverage test. A list three things depend on is worth
 * asserting about directly, and unlike the isolation suite this needs no
 * database — so it runs in CI, where a mistake in the register is caught before
 * anyone tries to apply a migration built from it.
 */

import { describe, it, expect } from 'vitest'
import {
  PLATFORM_TABLES,
  TENANT_SCOPED_TABLES,
  rlsDeferredTables,
  rlsEnabledTables,
} from '@/lib/domain/tenantScopedTables'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const SCHEMA = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const PENDING = path.resolve(process.cwd(), 'prisma/migrations-pending')

const MIGRATION = readFileSync(
  path.resolve(
    process.cwd(),
    'prisma/migrations-pending/20260831160000_commissioner_os_t102_rls/migration.sql',
  ),
  'utf8',
)

describe('T-102 · the register', () => {
  it('lists something in both states (positive control)', () => {
    // A register that is all-enabled or all-deferred would make one half of the
    // assertions below vacuous.
    expect(rlsEnabledTables().length).toBeGreaterThan(0)
    expect(rlsDeferredTables().length).toBeGreaterThan(0)
  })

  it('has no duplicate entries', () => {
    const names = TENANT_SCOPED_TABLES.map((t) => t.table)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every deferred table records WHY', () => {
    // A deferred entry with no reason is indistinguishable from an oversight,
    // and T-103 will fail on all of them — the note is what makes that failure
    // a known decision rather than a discovery.
    for (const t of rlsDeferredTables()) {
      expect(t.note, `${t.table} deferred with no reason`).toBeTruthy()
      expect(t.note!.length).toBeGreaterThan(40)
    }
  })

  it('only Tenant keys on its own id', () => {
    // TENANCY.md §5: Tenant has no tenantId, so its policy keys on the primary
    // key. Any OTHER table doing that would be scoping itself to a row id,
    // which silently matches nothing.
    for (const t of TENANT_SCOPED_TABLES) {
      expect(t.keyColumn === 'id' ? t.table : 'Tenant').toBe('Tenant')
    }
  })
})

describe('T-102 · the register agrees with the schema', () => {
  it('every enabled table exists as a model or a mapped table', () => {
    for (const t of rlsEnabledTables()) {
      const asModel = new RegExp(`^model ${t.table} \\{`, 'm').test(SCHEMA)
      const asMapped = SCHEMA.includes(`@@map("${t.table}")`)
      expect(asModel || asMapped, `${t.table} is in the register but not in schema.prisma`).toBe(true)
    }
  })

  it('every enabled table except Tenant really has a tenantId column', () => {
    // A policy keyed on a column that does not exist fails at CREATE POLICY —
    // late, on a database, rather than here.
    for (const t of rlsEnabledTables()) {
      if (t.table === 'Tenant') continue
      const model = new RegExp(`^model ${t.table} \\{[\\s\\S]*?^\\}`, 'm').exec(SCHEMA)
      expect(model, `${t.table} not found in schema`).not.toBeNull()
      expect(/^\s+tenantId\s/m.test(model![0]), `${t.table} has no tenantId`).toBe(true)
    }
  })

  it('leagues is deferred, and says so in the register', () => {
    // The single most consequential entry. Pinned so that flipping it to true
    // has to break a test with the reason written next to it.
    const leagues = TENANT_SCOPED_TABLES.find((t) => t.table === 'leagues')
    expect(leagues).toBeDefined()
    expect(leagues!.rlsEnabled).toBe(false)
    expect(leagues!.note).toMatch(/1,020|outage/)
  })
})

describe('T-102 · the migration agrees with the register', () => {
  it('every enabled table gets a policy in SOME parked migration', () => {
    // ⚠ THIS USED TO ASSERT AGAINST T-102's LOOP ALONE, AND T-201 CORRECTLY
    // BROKE IT. New tenant-scoped tables get their policies in their OWN
    // migration — LeagueBinding and SyncJob are created and policed by the
    // T-201 migration, not retro-fitted into T-102's.
    //
    // So the invariant is not "one loop lists everything"; it is "every enabled
    // table is policed somewhere, and no migration polices a table the register
    // does not know about". That is the same guarantee and it survives the next
    // table too. Generalised rather than relaxed: both directions are still
    // asserted below.
    const covered = new Set<string>()
    for (const file of readdirSync(PENDING, { withFileTypes: true })) {
      if (!file.isDirectory()) continue
      const sqlPath = path.join(PENDING, file.name, 'migration.sql')
      if (!existsSync(sqlPath)) continue
      const sql = readFileSync(sqlPath, 'utf8')
      for (const m of sql.matchAll(/FOREACH t IN ARRAY ARRAY\[([^\]]+)\]/g)) {
        for (const raw of m[1].split(',')) covered.add(raw.trim().replace(/'/g, ''))
      }
    }

    const enabled = rlsEnabledTables().map((t) => t.model)

    // Every enabled table is policed by something.
    const unpoliced = enabled.filter((t) => !covered.has(t))
    expect(
      unpoliced,
      `enabled in the register but no migration creates a policy: ${unpoliced.join(', ')}`,
    ).toEqual([])

    // And nothing is policed that the register does not list — a policy on an
    // unregistered table means T-103 is not watching it.
    //
    // ⚠ The T-106 suspension migration ALTERs four already-created policies
    // rather than creating them, so its loop is a subset by design and is not
    // evidence of an extra table.
    const unregistered = [...covered].filter((t) => !enabled.includes(t))
    expect(
      unregistered,
      `a migration polices tables the register does not list: ${unregistered.join(', ')}`,
    ).toEqual([])
  })

  it('does NOT enable RLS on leagues', () => {
    // Every `leagues` statement in that file must be commented out. An
    // uncommented one is a production outage across 1,020 call sites.
    const live = MIGRATION.split('\n').filter(
      (line) => !line.trim().startsWith('--') && /"leagues"/.test(line),
    )
    expect(live, `uncommented leagues statements: ${live.join(' | ')}`).toEqual([])
  })

  it('grants EXECUTE on every bootstrap function it creates', () => {
    // A SECURITY DEFINER function commish_app cannot execute is dead weight;
    // one it can execute that was never REVOKEd from PUBLIC is a hole. Both
    // halves are asserted.
    const created = [...MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION (app\.\w+)/g)].map((m) => m[1])
    expect(created.length).toBeGreaterThan(0)
    for (const fn of created) {
      expect(MIGRATION, `${fn} not REVOKEd from PUBLIC`).toContain(`REVOKE ALL ON FUNCTION ${fn}`)
      expect(MIGRATION, `${fn} not granted to commish_app`).toContain(`GRANT EXECUTE ON FUNCTION ${fn}`)
    }
  })

  it('every bootstrap function pins its search_path', () => {
    // Without it a caller can put their own schema first and have the
    // function's unqualified names resolve to their objects — the classic
    // SECURITY DEFINER escalation.
    const definers = MIGRATION.split('CREATE OR REPLACE FUNCTION').slice(1)
    for (const body of definers) {
      expect(body).toContain('SECURITY DEFINER')
      expect(body).toContain('SET search_path')
    }
  })
})

describe('T-102 · PlatformGrant', () => {
  it('is listed as a platform table, not a tenant-scoped one', () => {
    expect(PLATFORM_TABLES).toContain('PlatformGrant')
    expect(TENANT_SCOPED_TABLES.map((t) => t.table)).not.toContain('PlatformGrant')
  })

  it('gets RLS but NO policy for commish_app', () => {
    // The default for a table without RLS is "every row to anyone with SELECT",
    // and this is the table that decides who is a platform admin. It must not
    // be that kind of table — and the app must reach it only through the
    // bootstrap function.
    expect(MIGRATION).toContain('ALTER TABLE "PlatformGrant" FORCE ROW LEVEL SECURITY')
    const grantPolicies = MIGRATION.slice(MIGRATION.indexOf('ALTER TABLE "PlatformGrant"'))
    const appPolicy = /CREATE POLICY \w+ ON "PlatformGrant"[\s\S]{0,120}?TO commish_app/.test(
      grantPolicies,
    )
    expect(appPolicy, 'commish_app must have no direct policy on PlatformGrant').toBe(false)
  })
})
