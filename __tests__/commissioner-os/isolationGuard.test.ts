/**
 * Commissioner OS · the guard that refuses a connection which cannot be isolated.
 *
 * ── 🛑 WHAT THIS PINS ────────────────────────────────────────────────────────────────────────
 * T-102's policies are applied to production — 9 tables, 27 policies. The app still connects as
 * a role that INHERITS `commish_migrate`, so it matches the maintenance policy `USING (true)`
 * and RLS returns every tenant's rows. Measured on a Neon branch: `app.tenant_id` set to a
 * tenant owning 1 row returned 5.
 *
 * That failure is silent in every way that matters. `set_config` succeeds. The query succeeds.
 * A test asserting `withTenant` was called passes. The only thing missing is the isolation.
 *
 * So the branches below are the security property, and each is asserted directly rather than
 * through `withTenant` — where a passing test would prove only that the guard was invoked.
 */
import { describe, it, expect, vi } from 'vitest'

import {
  ISOLATION_FACTS_SQL,
  IsolationNotEnforceableError,
  MAINTENANCE_ROLES,
  createIsolationAssertion,
  factsFromRow,
  isolationFailureReason,
  type IsolationFacts,
  type IsolationFactsRow,
} from '@/lib/domain/isolationGuard'

/** A clean row: an ordinary role, in a database that has policies. */
function row(over: Partial<IsolationFactsRow> = {}): IsolationFactsRow {
  return {
    role: 'commish_app',
    bypasses_rls: false,
    is_superuser: false,
    in_migrate: false,
    in_purge: false,
    policies_exist: true,
    ...over,
  }
}

function facts(over: Partial<IsolationFacts> = {}): IsolationFacts {
  return { ...factsFromRow(row()), ...over }
}

describe('isolationFailureReason — the verdict', () => {
  it('passes a role that owns nothing and inherits nothing', () => {
    expect(isolationFailureReason(facts())).toBeNull()
  })

  it('⚠ passes when NO policies exist — the window db.ts calls safe', () => {
    // A fresh local database. There is nothing to bypass, and refusing here would stop anyone
    // running the app before T-102 is applied locally. The guard switches itself on when the
    // thing it protects starts existing.
    expect(isolationFailureReason(facts({ policiesExist: false, isSuperuser: true }))).toBeNull()
    expect(
      isolationFailureReason(facts({ policiesExist: false, inheritedMaintenanceRoles: ['commish_migrate'] })),
    ).toBeNull()
  })

  it('🛑 refuses a MEMBER of commish_migrate — the failure this repo actually has', () => {
    const reason = isolationFailureReason(
      facts({ role: 'neondb_owner', inheritedMaintenanceRoles: ['commish_migrate'] }),
    )
    expect(reason).toContain('neondb_owner')
    expect(reason).toContain('MEMBER')
    expect(reason).toContain('USING (true)')
    // The message must not misdescribe the cause — ownership was transferred correctly, and
    // someone reading "the app owns the tables" would go and check a thing that is already fine.
    expect(reason).toContain('not the "app owns the tables" failure')
  })

  it('refuses a member of commish_purge too', () => {
    expect(isolationFailureReason(facts({ inheritedMaintenanceRoles: ['commish_purge'] }))).toContain(
      'commish_purge',
    )
  })

  it('refuses BYPASSRLS and SUPERUSER separately, because the remedy differs', () => {
    expect(isolationFailureReason(facts({ bypassesRls: true }))).toContain('BYPASSRLS')
    expect(isolationFailureReason(facts({ isSuperuser: true }))).toContain('SUPERUSER')
  })

  it('⚠ commish_platform membership is NOT a failure', () => {
    // Its policy is FOR SELECT … USING (true): cross-tenant, read-only, and deliberate
    // (TENANCY.md §3.3 — "cross-tenant access is a role, not a variable"). Treating it as a
    // violation would refuse the one path designed to see across tenants.
    expect(MAINTENANCE_ROLES).not.toContain('commish_platform')
    expect(isolationFailureReason(facts({ role: 'commish_platform' }))).toBeNull()
  })
})

describe('🛑 the real production connection, measured 2026-09-01', () => {
  /*
   * Not invented. This is the exact row the shipped ISOLATION_FACTS_SQL returned when run
   * against the All Fantasy Neon project (icy-field-51189449, Postgres 17) — which also proves
   * the query itself parses and executes, including `to_regrole` and the oid form of
   * `pg_has_role`, on the real server rather than only against fakes.
   *
   * ⚠ IT IS WORSE THAN THE DOCUMENTED FAILURE. TENANCY.md §3.1 anticipates "the app's role owns
   * the tables" and the migrations README found "the app's role INHERITS the owner". Both are
   * true-ish here, and neither is the most severe fact: `neondb_owner` carries BYPASSRLS, so
   * policies are not evaluated at all. Three independent reasons this connection cannot be
   * isolated, and RLS on 9 tables with 27 policies does nothing for any of them.
   */
  const PRODUCTION_ROW: IsolationFactsRow = {
    role: 'neondb_owner',
    bypasses_rls: true,
    is_superuser: false,
    in_migrate: true,
    in_purge: true,
    policies_exist: true,
  }

  it('is refused, and named by its most severe cause', async () => {
    const assert = createIsolationAssertion(() => 'DATABASE_URL')
    const err = await assert(async () => [PRODUCTION_ROW]).catch((e) => e)
    expect(err).toBeInstanceOf(IsolationNotEnforceableError)
    // BYPASSRLS is checked before membership on purpose: it is the stronger statement, and
    // reporting "member of commish_migrate" would send someone to fix the lesser problem.
    expect(err.message).toContain('BYPASSRLS')
    expect(err.message).toContain('neondb_owner')
  })

  it('⚠ TENANCY.md §3.1 names Supabase and RDS as BYPASSRLS defaults — Neon belongs on that list', () => {
    // Recorded as a test rather than only prose so the fact survives someone rewriting the doc.
    expect(factsFromRow(PRODUCTION_ROW).bypassesRls).toBe(true)
    expect(isolationFailureReason(factsFromRow(PRODUCTION_ROW))).toContain('BYPASSRLS')
  })
})

describe('the SQL', () => {
  it('asks about roles in a way that cannot raise when they do not exist', () => {
    // `pg_has_role(name, oid, ...)` returns NULL for a NULL oid, and to_regrole returns NULL
    // rather than erroring for an unknown name. A database predating T-001 must answer, not
    // throw — otherwise the guard turns "no roles yet" into a hard outage.
    expect(ISOLATION_FACTS_SQL).toContain('to_regrole')
    expect(ISOLATION_FACTS_SQL).not.toMatch(/'commish_migrate'\s*,\s*'MEMBER'/)
    for (const r of MAINTENANCE_ROLES) expect(ISOLATION_FACTS_SQL).toContain(r)
  })
})

describe('createIsolationAssertion — behaviour against a fake connection', () => {
  const src = () => 'DATABASE_URL'

  it('lets a clean connection through, and asks Postgres exactly once', async () => {
    const readFacts = vi.fn(async () => [row()])
    const assert = createIsolationAssertion(src)
    await assert(readFacts)
    await assert(readFacts)
    expect(readFacts).toHaveBeenCalledTimes(1)
  })

  it('🛑 throws IsolationNotEnforceableError, and keeps throwing', async () => {
    const readFacts = vi.fn(async () => [row({ role: 'neondb_owner', in_migrate: true })])
    const assert = createIsolationAssertion(src)

    await expect(assert(readFacts)).rejects.toBeInstanceOf(
      IsolationNotEnforceableError,
    )
    // Caching a FAILURE matters as much as caching a success: a guard that throws once and then
    // passes is worse than no guard, because the first request papers over every later one.
    await expect(assert(readFacts)).rejects.toBeInstanceOf(
      IsolationNotEnforceableError,
    )
    expect(readFacts).toHaveBeenCalledTimes(1)
  })

  it('carries the facts on the error, so the operator is not left guessing', async () => {
    const readFacts = async () => [row({ role: 'neondb_owner', in_migrate: true })]
    const assert = createIsolationAssertion(src)
    const err = await assert(readFacts).catch((e) => e)
    expect(err).toBeInstanceOf(IsolationNotEnforceableError)
    expect((err as IsolationNotEnforceableError).facts.role).toBe('neondb_owner')
    expect(err.message).toContain('DATABASE_URL')
    expect(err.message).toContain('NOLOGIN')
  })

  it('🛑 an unanswerable question is a REFUSAL, not a pass', async () => {
    // If the catalogue query itself fails we do not know whether isolation holds. "Could not
    // check" reading the same as "fine" is the exact shape this module exists to refuse.
    const readFacts = vi.fn(async () => {
      throw new Error('permission denied for table pg_policy')
    })
    const assert = createIsolationAssertion(src)
    await expect(assert(readFacts)).rejects.toThrow(/could not determine/i)
  })

  it('a transient failure is NOT cached — it is re-asked', async () => {
    let calls = 0
    const readFacts = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('connection reset')
      return [row()]
    })
    const assert = createIsolationAssertion(src)
    await expect(assert(readFacts)).rejects.toThrow()
    await expect(assert(readFacts)).resolves.toBeUndefined()
  })

  it('refuses when the query returns no row', async () => {
    const readFacts = async () => []
    const assert = createIsolationAssertion(src)
    await expect(assert(readFacts)).rejects.toThrow(/no row returned/i)
  })
})

describe('the control: these assertions can fail', () => {
  it('a clean role and a migrate member do NOT produce the same verdict', () => {
    // Without this, every "refuses X" test above would pass against a function that returned a
    // non-null reason unconditionally — which would also break every developer's local database.
    const clean = isolationFailureReason(facts())
    const member = isolationFailureReason(facts({ inheritedMaintenanceRoles: ['commish_migrate'] }))
    expect(clean).toBeNull()
    expect(member).not.toBeNull()
    expect(() => expect(clean).not.toBeNull()).toThrow()
  })
})
