/**
 * Commissioner OS · refuse to serve tenant-scoped queries on a connection that cannot be isolated.
 *
 * ── 🛑 THE PROTECTION `db.ts` PROMISES, WHICH WAS NEVER BUILT ────────────────────────────────
 *
 * `lib/domain/db.ts` falls back from `COMMISH_APP_URL` to `DATABASE_URL`, and its header says
 * why that is safe: "Before RLS exists there is nothing to bypass… The moment policies land,
 * running as the owner silently reverts isolation to nothing. That is not left to vigilance.
 * T-102's first assertion is `current_user = 'commish_app'`, and it is specified to fail loudly
 * otherwise."
 *
 * T-102's policies were applied to production on 2026-08-31 — 9 tables with RLS, 27 policies.
 * The assertion was not written. The only occurrence of `current_user` in that file is the
 * sentence promising it. So the condition the fallback's safety argument depends on has
 * occurred, and the thing it points at to catch that does not exist.
 *
 * ── ⚠ AND THE FAILURE IS NOT "THE APP IS THE TABLE OWNER" ───────────────────────────────────
 *
 * That is the failure `TENANCY.md` §3.1 names, and it is not the one this repo has. Ownership
 * was transferred: all 688 public tables belong to `commish_migrate` and `commish_app` owns
 * zero. The app is not the owner.
 *
 * It is a MEMBER of the owner. `neondb_owner` — the role the running app actually connects as —
 * inherits `commish_migrate`, so it matches the `maintenance` policy (`FOR ALL TO
 * commish_migrate, commish_purge USING (true)`) and RLS hands it every row. Measured on a Neon
 * branch: `app.tenant_id` set to a tenant owning 1 row returned **5** — the whole table.
 *
 * So a request path wired through `withTenant` today sets the GUC, reads correctly, passes any
 * test asserting `withTenant` was called, and isolates nothing. That is the "check that cannot
 * fail" shape in the root CLAUDE.md, wearing security clothing: the mechanism runs, the test
 * observes the mechanism running, and the property the mechanism exists to produce is absent.
 *
 * ── WHAT THIS ASKS, AND WHY IT IS A CAPABILITY QUESTION RATHER THAN A NAME CHECK ─────────────
 *
 * T-102 specifies `current_user = 'commish_app'` for its isolation SUITE, where the exact role
 * is the point and anything else means the control is not running. Here the honest question is
 * narrower and more portable: **can this connection be isolated at all?** A name check would
 * refuse a correctly-configured local database whose role is called something else, and would
 * pass a role named `commish_app` that had been granted `BYPASSRLS` by hand.
 *
 * Three ways a connection cannot be isolated, and all three are asked directly:
 *   1. `rolbypassrls` — RLS is skipped outright.
 *   2. superuser — bypasses everything, including `FORCE`.
 *   3. membership in a role whose policy is `USING (true)` — the one this repo actually has.
 *
 * ── ⚠ SELF-LIMITING BY CONSTRUCTION, WITH NO FLAG TO FORGET ─────────────────────────────────
 *
 * It refuses only when policies EXIST and the connection can defeat them. A fresh local database
 * with no policies is untouched, which is exactly the window `db.ts` describes as safe. There is
 * deliberately no `COMMISH_ALLOW_UNISOLATED` escape hatch: `vitest.setup.db-guard.ts` already
 * records why in this repo — a flag can be set once in a shell profile and then forgotten,
 * whereas "point it at a database that can be isolated" cannot be. The escape is to fix the
 * connection, not to silence the check.
 */

/** What Postgres says about the current connection's ability to be constrained by RLS. */
export type IsolationFacts = {
  /** `current_user` — the role policies are evaluated against. */
  role: string
  /** `rolbypassrls` on that role. */
  bypassesRls: boolean
  /** `rolsuper` — bypasses RLS and everything else. */
  isSuperuser: boolean
  /**
   * Roles this connection inherits that carry a `USING (true)` maintenance policy.
   * Empty when none exist (a database that predates T-001) or none are inherited.
   */
  inheritedMaintenanceRoles: string[]
  /** Whether ANY row-level policy exists in the database. */
  policiesExist: boolean
}

export class IsolationNotEnforceableError extends Error {
  readonly facts: IsolationFacts
  constructor(message: string, facts: IsolationFacts) {
    super(message)
    this.name = 'IsolationNotEnforceableError'
    this.facts = facts
  }
}

/**
 * The roles whose policies are `USING (true)` per TENANCY.md §3.2.
 *
 * ⚠ `commish_platform` is deliberately ABSENT. Its policy is `FOR SELECT … USING (true)` —
 * cross-tenant, but read-only and intentional (§3.3: "cross-tenant access is a role, not a
 * variable"). Treating it as a violation would refuse the one path that is supposed to work.
 * The two here are the ones whose grant is `FOR ALL`.
 */
export const MAINTENANCE_ROLES = ['commish_migrate', 'commish_purge'] as const

/**
 * One round trip. Written so a role that does not exist yields NULL rather than raising —
 * `pg_has_role(name, oid, ...)` returns NULL for a NULL oid, and `to_regrole` returns NULL
 * instead of erroring for an unknown name. A database that predates T-001 answers this cleanly.
 */
export const ISOLATION_FACTS_SQL = `
  SELECT
    current_user::text AS role,
    COALESCE((SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user), false) AS bypasses_rls,
    COALESCE((SELECT r.rolsuper      FROM pg_roles r WHERE r.rolname = current_user), false) AS is_superuser,
    COALESCE(pg_has_role(current_user, to_regrole('commish_migrate'), 'MEMBER'), false) AS in_migrate,
    COALESCE(pg_has_role(current_user, to_regrole('commish_purge'),   'MEMBER'), false) AS in_purge,
    EXISTS (SELECT 1 FROM pg_policy) AS policies_exist
`

/** Raw row shape from {@link ISOLATION_FACTS_SQL}. */
export type IsolationFactsRow = {
  role: string
  bypasses_rls: boolean
  is_superuser: boolean
  in_migrate: boolean
  in_purge: boolean
  policies_exist: boolean
}

export function factsFromRow(row: IsolationFactsRow): IsolationFacts {
  const inherited: string[] = []
  if (row.in_migrate) inherited.push('commish_migrate')
  if (row.in_purge) inherited.push('commish_purge')
  return {
    role: row.role,
    bypassesRls: Boolean(row.bypasses_rls),
    isSuperuser: Boolean(row.is_superuser),
    inheritedMaintenanceRoles: inherited,
    policiesExist: Boolean(row.policies_exist),
  }
}

/**
 * The verdict. Pure, so every branch is testable without Postgres.
 *
 * Returns null when the connection is fine, or the reason it is not.
 */
export function isolationFailureReason(facts: IsolationFacts): string | null {
  /*
   * ⚠ NO POLICIES MEANS NOTHING TO BYPASS, AND THAT IS NOT LENIENCY. It is the exact window
   * `db.ts` describes as safe — "before RLS exists there is nothing to bypass" — and it is how a
   * developer with a fresh local database runs the app at all. The check switches itself on when
   * the thing it protects starts existing.
   */
  if (!facts.policiesExist) return null

  if (facts.isSuperuser) {
    return `connected as "${facts.role}", which is a SUPERUSER — RLS does not apply to it, including FORCE`
  }
  if (facts.bypassesRls) {
    return `connected as "${facts.role}", which has BYPASSRLS — every policy is skipped`
  }
  if (facts.inheritedMaintenanceRoles.length > 0) {
    const roles = facts.inheritedMaintenanceRoles.join(', ')
    return (
      `connected as "${facts.role}", which is a MEMBER of ${roles} — ` +
      `that role's maintenance policy is USING (true), so every row of every tenant is returned. ` +
      `This is not the "app owns the tables" failure TENANCY.md §3.1 names; ownership was ` +
      `transferred correctly. Inheriting the owner has the same effect and looks correct.`
    )
  }
  return null
}

/** The minimum a caller must hand us — `Prisma.TransactionClient` satisfies it. */
export type RawQueryable = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

/**
 * Build the assertion with its own memo.
 *
 * ⚠ THE VERDICT IS CACHED INCLUDING FAILURE, AND THAT IS DELIBERATE. A guard that re-queries on
 * every transaction would add a round trip to every request; one that cached only success would
 * throw once and then pass, which is the worst of both. The connection's role cannot change
 * without a new client, and `db.ts` builds the client once per process.
 */
export function createIsolationAssertion(getConnectionSource: () => string | null) {
  let verdict: { ok: true } | { ok: false; error: IsolationNotEnforceableError } | null = null

  return async function assertIsolationEnforceable(tx: RawQueryable): Promise<void> {
    if (verdict) {
      if (verdict.ok) return
      throw verdict.error
    }

    let rows: IsolationFactsRow[]
    try {
      rows = await tx.$queryRawUnsafe<IsolationFactsRow[]>(ISOLATION_FACTS_SQL)
    } catch (cause) {
      /*
       * ⚠ AN UNANSWERABLE QUESTION IS NOT A PASS. If the catalogue query itself fails we do not
       * know whether this connection can be isolated, and "we could not check" must not read the
       * same as "it is fine" — that is the shape this whole module exists to refuse. Not cached:
       * a transient failure should be re-asked, unlike a real verdict.
       */
      throw new Error(
        `Commissioner OS could not determine whether this connection enforces tenant isolation, ` +
          `so it refuses to run the query. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }

    const row = Array.isArray(rows) ? rows[0] : undefined
    if (!row) {
      throw new Error(
        'Commissioner OS could not read the current role from Postgres (no row returned), so it ' +
          'refuses to run the query rather than assume isolation holds.',
      )
    }

    const facts = factsFromRow(row)
    const reason = isolationFailureReason(facts)
    if (reason) {
      const error = new IsolationNotEnforceableError(
        isolationErrorMessage(reason, getConnectionSource()),
        facts,
      )
      verdict = { ok: false, error }
      throw error
    }
    verdict = { ok: true }
  }
}

/** The error message, kept in one place so the throw and the tests cannot drift apart. */
export function isolationErrorMessage(reason: string, connectionSource: string | null): string {
  return (
    `Commissioner OS refuses to run a tenant-scoped query: ${reason}.\n` +
    `Connection came from ${connectionSource ?? 'an unknown source'}. ` +
    `Set COMMISH_APP_URL to a role that owns nothing, has neither BYPASSRLS nor SUPERUSER, and ` +
    `is a member of no maintenance role — TENANCY.md §3.1. The four roles are currently NOLOGIN; ` +
    `"ALTER ROLE commish_app LOGIN PASSWORD …" is the follow-up that turns this on.\n` +
    `This is deliberately fatal. A query that runs here returns every tenant's rows while ` +
    `looking, and testing, exactly like one that is correctly scoped.`
  )
}
