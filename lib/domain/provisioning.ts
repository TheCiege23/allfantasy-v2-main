/**
 * Commissioner OS · tenant provisioning and suspension. T-106.
 *
 * Create a tenant, invite the first `TENANT_OWNER`, seed plan limits, and
 * suspend or resume.
 *
 * ─── SUSPENSION IS ENFORCED BY THE DATABASE, NOT BY THIS FILE ────────────────
 * Nothing here checks "is this tenant suspended" before a write. That is the
 * point: the T-106 migration puts the predicate in every tenant-scoped table's
 * RLS `WITH CHECK`, so a write against a suspended tenant is refused by
 * Postgres whatever code path reaches it — including one written next year by
 * someone who never read this file.
 *
 * If you find yourself adding a suspension check to a service method, the
 * question to ask is why the database did not catch it, because that is where
 * the bug is.
 */

import type { ActorContext } from './actorContext'
import type { Tx } from './db'
import { type DomainError, invariant, notEntitled } from './errors'
import { type Result, err, ok } from './result'
import type { TenantRole } from './roles'

// ─── Plan limits ─────────────────────────────────────────────────────────────

export type PlanLimits = {
  readonly maxLeagues: number | null
  readonly maxSeats: number | null
  /** Requests per minute. T-114 enforces it centrally. */
  readonly apiRateLimit: number
}

/**
 * ⚠ CONFIG, BECAUSE TENANCY.md §7 REQUIRES IT: "Per-tenant limits. Leagues,
 * seats, API rate. Enforced centrally; a plan change must never need a deploy."
 *
 * The limits are COPIED onto the Tenant row at provisioning rather than looked
 * up through `planKey` at read time. That is deliberate: an operator's limits
 * must not change silently because someone edited a shared constant, and a
 * negotiated exception ("they get 200 leagues") has somewhere to live that is
 * not a special case in this map.
 *
 * `null` means unlimited, and it is distinct from `0` — which would mean a plan
 * that permits nothing and is the value a mis-parsed env var produces.
 */
export const PLAN_LIMITS: Record<string, PlanLimits> = {
  trial: { maxLeagues: 3, maxSeats: 5, apiRateLimit: 60 },
  starter: { maxLeagues: 25, maxSeats: 20, apiRateLimit: 120 },
  growth: { maxLeagues: 250, maxSeats: 100, apiRateLimit: 600 },
  enterprise: { maxLeagues: null, maxSeats: null, apiRateLimit: 3000 },
}

export const DEFAULT_PLAN_KEY = 'trial'

export function limitsForPlan(planKey: string): Result<PlanLimits, DomainError> {
  const limits = PLAN_LIMITS[planKey]
  if (!limits) {
    // Fail rather than defaulting to `trial`. A typo'd plan key that silently
    // provisioned a trial would be discovered by the customer, not by us.
    return err(invariant('plan.unknown', `Unknown plan "${planKey}".`))
  }
  return ok(limits)
}

/** Whether a tenant may add another of something. Returns NOT_ENTITLED, a 402. */
export function checkSeatLimit(
  limits: PlanLimits,
  currentSeats: number,
  planKey: string,
): Result<void, DomainError> {
  if (limits.maxSeats === null) return ok(undefined)
  if (currentSeats < limits.maxSeats) return ok(undefined)
  return err(notEntitled('maxSeats', planKey, { current: currentSeats, allowed: limits.maxSeats }))
}

export function checkLeagueLimit(
  limits: PlanLimits,
  currentLeagues: number,
  planKey: string,
): Result<void, DomainError> {
  if (limits.maxLeagues === null) return ok(undefined)
  if (currentLeagues < limits.maxLeagues) return ok(undefined)
  return err(
    notEntitled('maxLeagues', planKey, { current: currentLeagues, allowed: limits.maxLeagues }),
  )
}

// ─── Slug ────────────────────────────────────────────────────────────────────

/**
 * ⚠ A SLUG IS BURNED FOREVER — it is globally `@unique`, not a partial index,
 * because operators hardcode it into API paths and webhook payloads and a
 * closed tenant's identifier must never be silently reused by another.
 *
 * So it is worth validating carefully at the one moment it can still be
 * changed, which is before it exists.
 */
export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/

/**
 * Reserved because they collide with routes or read as us rather than as an
 * operator. `api` and `admin` would sit under the same path space; `platform`
 * and `commissioner-os` would let a tenant impersonate the platform in a URL an
 * operator's own customers see.
 */
export const RESERVED_SLUGS = new Set([
  'api', 'admin', 'app', 'www', 'platform', 'commissioner-os', 'commish',
  'support', 'status', 'billing', 'internal', 'system', 'null', 'undefined',
])

export function validateSlug(slug: string): Result<string, DomainError> {
  const normalised = slug.trim().toLowerCase()
  if (!SLUG_PATTERN.test(normalised)) {
    return err(
      invariant(
        'tenant.slug',
        'A slug is 3–40 characters, lowercase letters, digits and hyphens, not starting or ending with a hyphen.',
      ),
    )
  }
  if (RESERVED_SLUGS.has(normalised)) {
    return err(invariant('tenant.slug', `"${normalised}" is reserved.`))
  }
  return ok(normalised)
}

// ─── Provisioning ────────────────────────────────────────────────────────────

export type ProvisionTenantInput = {
  readonly tenantId: string
  readonly slug: string
  readonly name: string
  readonly planKey?: string
  readonly owner: {
    readonly userId: string
    readonly displayName: string
    readonly email: string
  }
}

export type ProvisionedTenant = {
  readonly tenantId: string
  readonly slug: string
  readonly planKey: string
  readonly limits: PlanLimits
  readonly ownerTenantUserId: string
}

/**
 * The rows a provision writes, as data.
 *
 * Split from the write so the shape is testable without a database, and so the
 * ORDER is assertable — `TenantMember` references `TenantUser`, and inverting
 * them is a foreign-key error that only appears once something is actually
 * inserted.
 */
export function planProvision(
  input: ProvisionTenantInput,
  limits: PlanLimits,
  ownerTenantUserId: string,
): ReadonlyArray<{ model: string; data: Record<string, unknown> }> {
  const planKey = input.planKey ?? DEFAULT_PLAN_KEY
  return [
    {
      model: 'Tenant',
      data: {
        id: input.tenantId,
        slug: input.slug,
        name: input.name,
        // TRIAL, not ACTIVE. A tenant becomes ACTIVE when billing says so, and
        // defaulting to ACTIVE here would mean provisioning grants entitlement
        // — the one decision this function must not make on its own.
        status: 'TRIAL',
        planKey,
        maxLeagues: limits.maxLeagues,
        maxSeats: limits.maxSeats,
        apiRateLimit: limits.apiRateLimit,
      },
    },
    {
      model: 'TenantUser',
      data: {
        id: ownerTenantUserId,
        tenantId: input.tenantId,
        userId: input.owner.userId,
        displayName: input.owner.displayName,
        email: input.owner.email,
      },
    },
    {
      model: 'TenantMember',
      data: {
        tenantId: input.tenantId,
        tenantUserId: ownerTenantUserId,
        role: 'TENANT_OWNER' satisfies TenantRole,
        // Set: the first owner is not invited, they are the reason the tenant
        // exists. A null joinedAt would leave them showing as a pending invite
        // in every member list forever.
        joinedAt: new Date(),
      },
    },
  ]
}

export type ProvisionDeps = {
  /**
   * Runs `fn` in a transaction scoped to the NEW tenant.
   *
   * ⚠ SCOPED TO THE TENANT BEING CREATED, WHICH LOOKS WRONG AND IS NOT.
   * `Tenant`'s policy is `WITH CHECK (id = current_setting('app.tenant_id'))`,
   * so an INSERT of the new row passes exactly when the session is already
   * scoped to the id being inserted. Generating the id first and opening
   * `withTenant(newId)` keeps provisioning inside `commish_app`'s own policy —
   * no maintenance role, no bypass, no exception to the isolation rule for the
   * one operation that creates tenants.
   */
  readonly withTenant: <T>(tenantId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>
  readonly create: (tx: Tx, model: string, data: Record<string, unknown>) => Promise<void>
  readonly newId: () => string
}

export async function provisionTenant(
  deps: ProvisionDeps,
  input: ProvisionTenantInput,
): Promise<Result<ProvisionedTenant, DomainError>> {
  const slug = validateSlug(input.slug)
  if (!slug.ok) return err(slug.error)

  const planKey = input.planKey ?? DEFAULT_PLAN_KEY
  const limits = limitsForPlan(planKey)
  if (!limits.ok) return err(limits.error)

  if (!input.tenantId) {
    return err(invariant('tenant.id', 'provisionTenant requires a pre-generated tenantId.'))
  }
  if (!input.owner.email.includes('@')) {
    return err(invariant('tenant.owner.email', 'The first owner needs a real email address.'))
  }

  const ownerTenantUserId = deps.newId()
  const rows = planProvision({ ...input, slug: slug.value, planKey }, limits.value, ownerTenantUserId)

  await deps.withTenant(input.tenantId, async (tx) => {
    for (const row of rows) await deps.create(tx, row.model, row.data)
  })

  return ok({
    tenantId: input.tenantId,
    slug: slug.value,
    planKey,
    limits: limits.value,
    ownerTenantUserId,
  })
}

// ─── Suspension ──────────────────────────────────────────────────────────────

export const SUSPENDABLE_FROM = ['TRIAL', 'ACTIVE', 'PAST_DUE'] as const
export const RESUMABLE_FROM = ['SUSPENDED'] as const

/**
 * What a suspension changes, as data.
 *
 * ⚠ NOTHING HERE ENFORCES READ-ONLY. Setting `status` is the whole of it — the
 * enforcement is the RLS `WITH CHECK` added by the T-106 migration, which
 * consults `app.tenant_is_writable()`. A service-layer guard in addition would
 * be a second source of truth that can disagree with the first, and the one
 * that disagrees silently is always the one nobody is looking at.
 */
export function suspensionPatch(reason: string) {
  return { status: 'SUSPENDED', deleteReason: reason }
}

export function resumePatch(restoreTo: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' = 'ACTIVE') {
  // ⚠ Resuming to ACTIVE by default is a billing decision wearing a technical
  // one. A tenant suspended FROM `PAST_DUE` should generally return there, not
  // to ACTIVE — otherwise suspension silently clears a debt. The caller states
  // it; the default is the common case.
  return { status: restoreTo, deleteReason: null }
}
