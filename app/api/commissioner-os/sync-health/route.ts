/**
 * Commissioner OS · GET /api/commissioner-os/sync-health
 *
 * 🛑 THE FIRST REQUEST PATH THAT ACTUALLY GOES THROUGH `withTenant`.
 *
 * Until this route existed, `lib/domain/` had zero runtime importers outside its
 * own tests. The tenancy boundary was a design and a passing test suite; no
 * request had ever crossed it. This is the surface that makes invariant 2 ("one
 * write path") a fact about the running product rather than a statement about
 * the code.
 *
 * It serves T-204's acceptance criterion — "the state is exposed on the API" —
 * because degraded sync is the one thing here that a human needs to see and
 * cannot infer: a league whose provider went dark looks completely healthy from
 * the outside, which is the entire point of that ticket.
 *
 * ─── WHY THIS ROUTE IS SHAPED THE WAY IT IS ──────────────────────────────────
 *
 * 1. NO PRISMA IMPORT. Every database access is `withTenant`. The route cannot
 *    reach the client even if it wanted to — `lib/domain/db.ts` exports the
 *    scope function and never the client. The ESLint boundary now covers
 *    `app/api/commissioner-os/**` so this stays true.
 *
 * 2. THE TENANT IS RESOLVED, NEVER TAKEN FROM THE REQUEST. There is deliberately
 *    no `?tenantId=` parameter and no `x-tenant-id` header. A tenant id supplied
 *    by the caller is an IDOR waiting to happen: RLS would faithfully scope to
 *    whatever it was handed. It comes from the session user's membership, via
 *    the one SECURITY DEFINER function that exists for that purpose.
 *
 * 3. NO `tenantId` IN THE QUERY. `findMany` below has no tenant filter, which
 *    looks like the bug this whole architecture exists to prevent and is the
 *    opposite: RLS supplies it. An app-level filter here would be a second,
 *    weaker copy of the rule — and the day the two disagree, the app-level one
 *    wins silently. §2: "a convenience layer, not the control".
 *
 * ⚠ THIS RETURNS 403 FOR EVERY REAL USER TODAY, AND THAT IS CORRECT.
 * `TenantMember` is empty in production: nobody has been provisioned into the
 * bootstrap tenant yet. The tempting fix — falling back to `'allfantasy'` when a
 * user has no membership — is the single most dangerous line that could be added
 * to this file, so the failure is left visible instead. Provisioning real
 * memberships (T-106's path) is what turns this on, and it should be a
 * deliberate act with an audit trail, not a default in a route handler.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { withTenant, resolveTenantsForUser } from '@/lib/domain/db'
import { createActorContext } from '@/lib/domain/actorContext'
import { authorize } from '@/lib/domain/authorize'
import { syncHealthView, type BindingSyncState } from '@/lib/domain/syncHealth'
import { toHttpResponse, forbidden, type DomainError } from '@/lib/domain/errors'

export const dynamic = 'force-dynamic'

type SessionShape = { user?: { id?: string | null; name?: string | null } } | null

/**
 * `toHttpResponse` returns `{ status, body }` — it does not build the response.
 * Keeping that mapping in one helper means no handler invents its own status for
 * a DomainError, which is how two routes end up disagreeing about what FORBIDDEN
 * means over the wire.
 */
function respond(error: DomainError) {
  const { status, body } = toHttpResponse(error)
  return NextResponse.json(body, { status })
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as never)) as SessionShape
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  }

  // ── Which tenant? Asked of the database, never of the caller. ──────────────
  const memberships = await resolveTenantsForUser(userId)
  if (memberships.length === 0) {
    // ⚠ FORBIDDEN, NOT NOT_ENTITLED. Both would 4xx and they say different
    // things: NOT_ENTITLED is a BILLING answer ("your plan does not include
    // this", fix = upgrade) and carries a plan key and a limit. "You are not a
    // member of any tenant" is an authorization answer with no plan involved.
    // Sending someone to a billing page over a missing membership is the kind
    // of refusal that fails to explain itself.
    return respond(
      forbidden(
        'league.sync.read',
        'This account is not a member of any Commissioner OS tenant.',
      ),
    )
  }

  // ⚠ FIRST MEMBERSHIP, AND THAT IS A KNOWN LIMITATION RATHER THAN A DECISION.
  // A person can work for two operators (TENANCY.md §4 is built on exactly that),
  // so "the tenant" is ambiguous for them. Picking the first is wrong for that
  // user and safe for everyone else — it never grants access to a tenant they
  // are not a member of. When a second operator exists this needs an explicit
  // selector; it is called out here rather than left for someone to discover.
  const membership = memberships[0]

  const ctxResult = createActorContext({
    userId,
    actorLabel: session?.user?.name ?? userId,
    tenantId: membership.tenantId,
    tenantRole: membership.role,
    requestId: request.headers.get('x-request-id') ?? undefined,
  })
  if (!ctxResult.ok) return respond(ctxResult.error)
  const ctx = ctxResult.value

  // `authorize` takes ONE argument — an object carrying the resource, because
  // the cross-tenant check needs the row before the role check (a resource from
  // another tenant is TENANT_MISMATCH, not FORBIDDEN, and the distinction is
  // what stops an enumeration oracle). There is no resource here: the query is
  // "everything in my own tenant", so the tenant itself is the resource.
  // ⚠ AWAITED. `Authorize` returns `Result | Promise<Result>` — the port allows
  // an async implementation (one that consults the database for a league role),
  // and the production matrix happens to be synchronous. Reading `.ok` off the
  // union without awaiting is `undefined`, which is falsy, so an un-awaited call
  // would REFUSE every request rather than allow them. Failing closed by
  // accident is still a bug: it would have looked like a permissions problem.
  const allowed = await authorize({
    ctx,
    requires: 'league.sync.read',
    resource: { tenantId: ctx.tenantId },
  })
  if (!allowed.ok) return respond(allowed.error)

  const now = new Date()

  // ── The crossing. Everything below runs inside the tenant scope. ───────────
  const bindings = await withTenant(ctx.tenantId, (tx) =>
    // No `where: { tenantId }`. See note 3 in the header — RLS supplies it.
    (tx as { leagueBinding: { findMany: (a: unknown) => Promise<unknown[]> } }).leagueBinding.findMany({
      select: {
        id: true,
        provider: true,
        status: true,
        consecutiveFailures: true,
        lastSyncedAt: true,
        lastErrorAt: true,
        lastErrorSummary: true,
      },
      orderBy: { id: 'asc' },
    }),
  )

  const view = (bindings as (BindingSyncState & { id: string; provider: string })[]).map((b) =>
    syncHealthView(b, now),
  )

  return NextResponse.json({
    tenantId: ctx.tenantId,
    requestId: ctx.requestId,
    checkedAt: now.toISOString(),
    bindings: view,
    degraded: view.filter((v) => v.degraded).length,
  })
}
