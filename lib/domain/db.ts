/**
 * Commissioner OS · the tenant-scoped database boundary. T-002.
 *
 * TENANCY.md §3.4. This module constructs the Commissioner OS Prisma client and
 * exports `withTenant` — never the bare client. That is invariant 1 and 2's
 * single enforcement point in code; everything else about them is lint (T-005).
 *
 * ─── WHY A SECOND CLIENT, WHEN `lib/prisma.ts` ALREADY EXISTS ────────────────
 * Because it connects as a DIFFERENT ROLE, and the role is the security
 * boundary. `lib/prisma.ts` connects as AllFantasy's database user — which owns
 * the tables. A table owner bypasses RLS unless the table is FORCE'd, so
 * routing Commissioner OS through it would leave every policy T-102 writes
 * doing nothing at all, while the isolation suite passed. TENANCY.md §3.1 calls
 * this out as the failure that makes "isolation tests pass against a control
 * that isn't running".
 *
 * So this client uses COMMISH_APP_URL — `commish_app`, which owns nothing, has
 * no BYPASSRLS, and is a member of no other role (asserted by T-001's suite).
 *
 * ⚠ IT FALLS BACK TO DATABASE_URL, AND THE FALLBACK IS UNSAFE AFTER T-102.
 * Before RLS exists there is nothing to bypass, so the fallback is how this
 * ships ahead of T-001 being applied — which the handoff explicitly expects
 * ("this ships against a seeded default tenant and is verified properly at
 * T-102"). The moment policies land, running as the owner silently reverts
 * isolation to nothing.
 *
 * That is not left to vigilance. T-102's first assertion is
 * `current_user = 'commish_app'`, and it is specified to "fail loudly
 * otherwise" precisely so this fallback cannot survive into a world where it
 * matters. `resolveConnectionUrl()` below also records which one it took, so
 * the state is inspectable rather than inferred.
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { AsyncLocalStorage } from 'node:async_hooks'
import { TenantMismatchError } from './errors'
import type { TenantRole } from './roles'

export { TenantMismatchError } from './errors'

/** The subset of the client a domain method is allowed to see. */
export type Tx = Prisma.TransactionClient

type OpenScope = { tenantId: string; tx: Tx }

/**
 * ⚠ MODULE-LEVEL, AND THAT IS THE POINT.
 * One store per process. A per-call store would make every `withTenant` look
 * like a fresh scope and re-entry would never be detected — which is the whole
 * mechanism.
 */
const als = new AsyncLocalStorage<OpenScope>()

// ─── Connection ──────────────────────────────────────────────────────────────

export type ConnectionSource = 'COMMISH_APP_URL' | 'DATABASE_URL'

let connectionSource: ConnectionSource | null = null

function resolveConnectionUrl(): { url: string; source: ConnectionSource } {
  const commish = process.env.COMMISH_APP_URL
  if (commish) return { url: commish, source: 'COMMISH_APP_URL' }

  const fallback = process.env.DATABASE_URL
  if (!fallback) {
    throw new Error(
      'Commissioner OS: neither COMMISH_APP_URL nor DATABASE_URL is set. ' +
        'See docs/commissioner-os/LOCAL-SETUP.md.',
    )
  }
  return { url: fallback, source: 'DATABASE_URL' }
}

/**
 * Which connection the client actually took, or null if it has not been
 * constructed yet. Diagnostic only — exported so T-102's role assertion can
 * report something useful when it fails, rather than just "wrong user".
 */
export function getConnectionSource(): ConnectionSource | null {
  return connectionSource
}

/**
 * ⚠ LAZY, DELIBERATELY.
 * Constructing at module load would (a) open a connection in any test that
 * merely imports this file and (b) throw at import time when no URL is
 * configured, which turns a missing env var into an unreadable module-resolution
 * error. Nothing here connects until the first `withTenant` call.
 */
let client: PrismaClient | null = null

function getClient(): PrismaClient {
  if (client) return client
  const { url, source } = resolveConnectionUrl()
  connectionSource = source
  client = new PrismaClient({ datasources: { db: { url } } })
  return client
}

// ─── withTenant ──────────────────────────────────────────────────────────────

/**
 * The factory. `withTenant` below is this bound to the real client.
 *
 * Exported so the re-entry semantics can be tested against a fake client with
 * no database — the identity of the transaction object and the number of
 * `$transaction` calls are the mechanism, and both are observable without
 * Postgres. It does NOT export the client, so invariant 2 holds: there is still
 * no way to get a bare client out of this module.
 */
export function createWithTenant(getDb: () => Pick<PrismaClient, '$transaction'>) {
  return async function withTenant<T>(
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!tenantId) {
      // An empty tenantId would be written into app.tenant_id, and TENANCY.md
      // §3.2's policies guard with nullif(…, '') — so it would match NOTHING
      // rather than everything. Safe, but it presents as "the database is
      // empty", which is among the most expensive bugs to read. Refuse early.
      throw new Error('withTenant requires a non-empty tenantId')
    }

    const open = als.getStore()
    if (open) {
      // Re-entry. Reuse the live transaction.
      //
      // Opening a second one takes a second connection from the pool, which
      // then blocks on the outer transaction's `SELECT … FOR UPDATE` (T-004
      // takes one on every mutation). That is a self-deadlock: it appears under
      // concurrency and never in a test that runs one request at a time.
      if (open.tenantId !== tenantId) {
        throw new TenantMismatchError(open.tenantId, tenantId)
      }
      return fn(open.tx)
    }

    return getDb().$transaction(
      async (tx) => {
        // set_config(..., true) — LOCAL to this transaction.
        //
        // ⚠ THE `true` IS LOAD-BEARING. Without it the value outlives the
        // transaction and leaks to whichever request next borrows this pooled
        // connection, which is a cross-tenant read that depends on pool timing.
        //
        // ⚠ AND THIS IS `set_config()` RATHER THAN `SET LOCAL` BECAUSE `SET`
        // CANNOT TAKE A BIND PARAMETER. The tagged template below parameterises
        // ${tenantId}; rewriting this as string interpolation to "simplify" it
        // would put caller-controlled text into a statement that sets the RLS
        // scope. Do not.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
        return als.run({ tenantId, tx }, () => fn(tx))
      },
      {
        // Every read now sits in a transaction, so the 5s default is too tight
        // — a slow page would abort mid-render. Both are explicit so a change
        // to either is a visible diff rather than a version bump.
        timeout: 15_000,
        maxWait: 5_000,
      },
    )
  }
}

/**
 * Run `fn` inside a transaction scoped to `tenantId`.
 *
 * Re-entrant: calling it inside an open scope for the SAME tenant reuses that
 * transaction. For a DIFFERENT tenant it throws `TenantMismatchError`.
 *
 * ```ts
 * const leagues = await withTenant(ctx.tenantId, (tx) =>
 *   tx.league.findMany({ where: { lifecycleState: 'ACTIVE' } }),
 * )
 * ```
 *
 * Note there is no `tenantId` in that `where`. That is the design: RLS supplies
 * it. An app-level filter is a convenience layer, not the control (§2).
 */
export const withTenant = createWithTenant(getClient)

// ─── The bootstrap: which tenant is this user in? ────────────────────────────

export type TenantMembership = { readonly tenantId: string; readonly role: TenantRole }

/**
 * Resolve a user's tenant memberships. **Runs OUTSIDE any tenant scope.**
 *
 * 🛑 THIS IS THE CHICKEN-AND-EGG, AND IT IS WHY T-102 SHIPPED A SECURITY DEFINER
 * FUNCTION. Every read inside `withTenant` is filtered by `app.tenant_id`. To set
 * that GUC you need the tenant id. To learn the tenant id you must read
 * `TenantMember`/`TenantUser` — which are RLS-protected, so as `commish_app` with
 * no scope set they return ZERO ROWS. Asked naively, the question can never be
 * answered: you cannot look up your tenant without already knowing it.
 *
 * `app.resolve_user_tenants` breaks the cycle. It is SECURITY DEFINER and owned
 * by `commish_migrate`, so it executes with the maintenance policy's visibility
 * rather than the caller's, and `commish_app` holds EXECUTE on it and nothing
 * more. The escape from RLS is one function with a fixed body and a single
 * parameter — not a role that can read across tenants.
 *
 * ⚠ DO NOT "FIX" AN EMPTY RESULT WITH A DEFAULT TENANT. Today every league
 * belongs to `allfantasy`, so `?? 'allfantasy'` would make this work immediately
 * and would be the single most dangerous line in the codebase: the moment a
 * second operator exists, an unrecognised user silently acquires access to the
 * bootstrap tenant, and RLS cannot catch it because the rows are legitimately
 * readable by the tenant they were scoped to. Empty means NOT ENTITLED. That is
 * the whole answer.
 *
 * ⚠ AND IT IS DELIBERATELY NOT CACHED. Membership is an authorization input;
 * caching it means a revoked member keeps access for the cache's lifetime. If
 * this becomes a latency problem the fix is a shorter-lived session, not a
 * longer-lived copy of a permission.
 */
export async function resolveTenantsForUser(userId: string): Promise<TenantMembership[]> {
  if (!userId.trim()) return []
  const rows = await getClient().$queryRaw<{ tenant_id: string; role: TenantRole }[]>`
    SELECT tenant_id, role FROM app.resolve_user_tenants(${userId})
  `
  return rows.map((r) => ({ tenantId: r.tenant_id, role: r.role }))
}

/**
 * Close the pool. For test teardown and graceful shutdown only.
 *
 * Deliberately not `getClient()` — calling this when no client was ever
 * constructed must not construct one just to disconnect it.
 */
export async function disconnect(): Promise<void> {
  await client?.$disconnect()
  client = null
  connectionSource = null
}
