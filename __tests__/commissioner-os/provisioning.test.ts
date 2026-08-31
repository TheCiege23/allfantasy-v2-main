/**
 * Commissioner OS · T-106 — provisioning and suspension.
 *
 * The acceptance criterion — "a suspended tenant's writes are rejected at the
 * DATABASE, not just the service layer; reads and export still work" — is by
 * definition not testable in application code. It is in `suspension.spec.ts`.
 *
 * What is testable here is everything that decides WHAT gets written, plus the
 * property that most easily regresses: that this file does NOT contain a
 * service-layer suspension check. A second source of truth for read-only would
 * be the thing that silently disagrees with the database.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_PLAN_KEY,
  PLAN_LIMITS,
  RESERVED_SLUGS,
  checkLeagueLimit,
  checkSeatLimit,
  limitsForPlan,
  planProvision,
  provisionTenant,
  resumePatch,
  suspensionPatch,
  validateSlug,
} from '@/lib/domain/provisioning'

const OWNER = { userId: 'u1', displayName: 'Dana Okafor', email: 'dana@dynastyco.com' }

const input = (over: Record<string, unknown> = {}) => ({
  tenantId: 'tn_1',
  slug: 'dynastyco',
  name: 'DynastyCo',
  owner: OWNER,
  ...over,
})

function harness() {
  const created: Array<{ model: string; data: Record<string, unknown> }> = []
  const scopes: string[] = []
  return {
    created,
    scopes,
    deps: {
      withTenant: async <T,>(tenantId: string, fn: (tx: any) => Promise<T>) => {
        scopes.push(tenantId)
        return fn({ id: 'tx' })
      },
      create: async (_tx: any, model: string, data: Record<string, unknown>) => {
        created.push({ model, data })
      },
      newId: () => 'tu_owner',
    },
  }
}

describe('T-106 · slugs', () => {
  it.each(['dynastyco', 'dynasty-co', 'a1b', 'x'.repeat(40)])('accepts %s', (slug) => {
    expect(validateSlug(slug).ok).toBe(true)
  })

  it.each([
    ['too short', 'ab'],
    ['leading hyphen', '-abc'],
    ['trailing hyphen', 'abc-'],
    ['uppercase mid', 'Dyn$asty'],
    ['underscore', 'dynasty_co'],
    ['too long', 'x'.repeat(41)],
    ['empty', ''],
  ])('rejects %s', (_label, slug) => {
    expect(validateSlug(slug).ok).toBe(false)
  })

  it('normalises case rather than rejecting it', () => {
    // A slug is burned forever and typed by a human once. Rejecting "DynastyCo"
    // when "dynastyco" is available is friction with no safety benefit.
    const r = validateSlug('  DynastyCo  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe('dynastyco')
  })

  it.each([...RESERVED_SLUGS])('reserves %s', (slug) => {
    expect(validateSlug(slug).ok).toBe(false)
  })

  it('reserves the ones that would let a tenant impersonate the platform', () => {
    // `platform` and `commissioner-os` in a URL an operator's own customers see
    // is the case that matters, not the routing collision.
    for (const s of ['platform', 'commissioner-os', 'api', 'admin']) {
      expect(RESERVED_SLUGS.has(s), `${s} should be reserved`).toBe(true)
    }
  })
})

describe('T-106 · plan limits', () => {
  it('every plan declares all three limits', () => {
    for (const [key, limits] of Object.entries(PLAN_LIMITS)) {
      expect(limits, `${key}`).toHaveProperty('maxLeagues')
      expect(limits, `${key}`).toHaveProperty('maxSeats')
      expect(limits.apiRateLimit, `${key} rate limit`).toBeGreaterThan(0)
    }
  })

  it('the default plan exists', () => {
    expect(PLAN_LIMITS[DEFAULT_PLAN_KEY]).toBeDefined()
  })

  it('rejects an unknown plan rather than defaulting', () => {
    // A typo'd plan key that silently provisioned a trial would be discovered
    // by the customer, not by us.
    expect(limitsForPlan('groath').ok).toBe(false)
  })

  it('null means unlimited and is distinct from zero', () => {
    // `0` is what a mis-parsed env var produces, and it would mean a plan that
    // permits nothing while looking deliberate.
    expect(PLAN_LIMITS.enterprise.maxLeagues).toBeNull()
    const r = checkLeagueLimit(PLAN_LIMITS.enterprise, 10_000, 'enterprise')
    expect(r.ok).toBe(true)
  })

  it('refuses at the limit, not past it', () => {
    // Off-by-one here means every plan silently sells one extra seat.
    const limits = PLAN_LIMITS.trial
    expect(checkSeatLimit(limits, limits.maxSeats! - 1, 'trial').ok).toBe(true)
    expect(checkSeatLimit(limits, limits.maxSeats!, 'trial').ok).toBe(false)
  })

  it('a limit refusal is NOT_ENTITLED — a 402, not a 403', () => {
    // "You may never" and "not on this plan yet" are different screens and a
    // different next click for the operator.
    const r = checkSeatLimit(PLAN_LIMITS.trial, 99, 'trial')
    if (r.ok) throw new Error('expected failure')
    expect(r.error.code).toBe('NOT_ENTITLED')
    expect(r.error).toMatchObject({ limit: 'maxSeats', planKey: 'trial', allowed: 5 })
  })
})

describe('T-106 · what a provision writes', () => {
  it('writes Tenant, then TenantUser, then TenantMember', () => {
    // Order matters: TenantMember references TenantUser. Inverting them is a
    // foreign-key error that only appears once something is actually inserted.
    const rows = planProvision(input(), PLAN_LIMITS.trial, 'tu_owner')
    expect(rows.map((r) => r.model)).toEqual(['Tenant', 'TenantUser', 'TenantMember'])
  })

  it('starts the tenant as TRIAL, not ACTIVE', () => {
    // Defaulting to ACTIVE would mean provisioning grants entitlement — the one
    // decision this must not make on its own. Billing says when a tenant is
    // active.
    const [tenant] = planProvision(input(), PLAN_LIMITS.trial, 'tu_owner')
    expect(tenant.data.status).toBe('TRIAL')
  })

  it('copies the plan limits onto the row', () => {
    // Copied, not looked up through planKey at read time: an operator's limits
    // must not change silently because someone edited a shared constant, and a
    // negotiated exception needs somewhere to live.
    const [tenant] = planProvision(input({ planKey: 'growth' }), PLAN_LIMITS.growth, 'tu_owner')
    expect(tenant.data).toMatchObject({
      maxLeagues: PLAN_LIMITS.growth.maxLeagues,
      maxSeats: PLAN_LIMITS.growth.maxSeats,
      apiRateLimit: PLAN_LIMITS.growth.apiRateLimit,
    })
  })

  it('makes the first member a TENANT_OWNER', () => {
    const rows = planProvision(input(), PLAN_LIMITS.trial, 'tu_owner')
    expect(rows[2].data).toMatchObject({ role: 'TENANT_OWNER', tenantUserId: 'tu_owner' })
  })

  it('marks the first owner as joined, not invited', () => {
    // A null joinedAt would leave them showing as a pending invite in every
    // member list forever. The first owner is not invited — they are the reason
    // the tenant exists.
    const rows = planProvision(input(), PLAN_LIMITS.trial, 'tu_owner')
    expect(rows[2].data.joinedAt).toBeInstanceOf(Date)
  })
})

describe('T-106 · provisionTenant', () => {
  it('opens the transaction scoped to the NEW tenant', async () => {
    // 🛑 THE THING THAT LOOKS WRONG AND IS NOT.
    // Tenant's policy is WITH CHECK (id = current_setting('app.tenant_id')), so
    // inserting the new row passes exactly when the session is already scoped to
    // the id being inserted. Generating the id first keeps provisioning inside
    // commish_app's own policy — no maintenance role, no bypass, no exception to
    // the isolation rule for the one operation that creates tenants.
    const h = harness()
    await provisionTenant(h.deps, input())
    expect(h.scopes).toEqual(['tn_1'])
  })

  it('creates all three rows in one transaction', async () => {
    const h = harness()
    const r = await provisionTenant(h.deps, input())
    expect(r.ok).toBe(true)
    expect(h.created.map((c) => c.model)).toEqual(['Tenant', 'TenantUser', 'TenantMember'])
  })

  it('returns the owner’s TenantUser id', async () => {
    const h = harness()
    const r = await provisionTenant(h.deps, input())
    if (!r.ok) throw new Error('expected success')
    expect(r.value.ownerTenantUserId).toBe('tu_owner')
  })

  it('writes nothing when the slug is invalid', async () => {
    const h = harness()
    const r = await provisionTenant(h.deps, input({ slug: '-nope-' }))
    expect(r.ok).toBe(false)
    expect(h.created).toEqual([])
  })

  it('writes nothing when the plan is unknown', async () => {
    const h = harness()
    const r = await provisionTenant(h.deps, input({ planKey: 'groath' }))
    expect(r.ok).toBe(false)
    expect(h.created).toEqual([])
  })

  it('requires a pre-generated tenantId', async () => {
    // Not generated inside, because the caller needs it BEFORE the transaction
    // opens — that is what makes the scoped-to-itself insert work.
    const h = harness()
    const r = await provisionTenant(h.deps, input({ tenantId: '' }))
    expect(r.ok).toBe(false)
  })

  it('requires a plausible owner email', async () => {
    const h = harness()
    const r = await provisionTenant(h.deps, input({ owner: { ...OWNER, email: 'dana' } }))
    expect(r.ok).toBe(false)
  })
})

describe('T-106 · suspension', () => {
  it('sets only the status', () => {
    expect(suspensionPatch('Non-payment after 60 days.')).toMatchObject({ status: 'SUSPENDED' })
  })

  it('resume restores to a caller-stated status', () => {
    // Resuming to ACTIVE by default is a billing decision wearing a technical
    // one: a tenant suspended FROM PAST_DUE should generally return there, or
    // suspension silently clears a debt.
    expect(resumePatch('PAST_DUE').status).toBe('PAST_DUE')
    expect(resumePatch().status).toBe('ACTIVE')
  })

  it('🛑 this module contains NO service-layer read-only check', () => {
    // The acceptance criterion is "rejected at the DATABASE, not just the
    // service layer". A guard here in addition would be a second source of
    // truth that can disagree with the first — and the one that disagrees
    // silently is always the one nobody is looking at.
    //
    // Asserted against the source text because the property is an ABSENCE, and
    // an absence cannot be asserted by calling anything.
    const source = readFileSync(
      path.resolve(process.cwd(), 'lib/domain/provisioning.ts'),
      'utf8',
    )
    const code = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
      .join('\n')

    // No comparison against SUSPENDED outside the state-machine constants.
    expect(code).not.toMatch(/===\s*['"]SUSPENDED['"]/)
    expect(code).not.toMatch(/!==\s*['"]SUSPENDED['"]/)
    expect(code).not.toMatch(/isSuspended|assertWritable|checkSuspend/)
  })

  it('the migration puts the predicate in WITH CHECK only, never USING', () => {
    // USING would make a suspended tenant's data invisible rather than
    // read-only — and T-106 requires reads and export to keep working. A
    // suspended tenant is exactly the tenant most likely to be exporting.
    const migration = readFileSync(
      path.resolve(
        process.cwd(),
        'prisma/migrations-pending/20260831170000_commissioner_os_t106_suspension/migration.sql',
      ),
      'utf8',
    )
    const usingLines = migration
      .split('\n')
      .filter((l) => !l.trim().startsWith('--') && /USING\s*\(/.test(l))
    for (const line of usingLines) {
      expect(line, `tenant_is_writable must not appear in USING: ${line}`).not.toContain(
        'tenant_is_writable',
      )
    }
    expect(migration).toMatch(/WITH CHECK[\s\S]{0,200}tenant_is_writable/)
  })

  it('Tenant and AuditEvent are excluded from the suspension check', () => {
    // Both would deadlock, and each was going to be included until the
    // consequence was traced:
    //   Tenant     — suspension would be irreversible; the UPDATE that resumes
    //                it would itself be blocked.
    //   AuditEvent — export is an audited action, so blocking audit writes
    //                would break the export that T-106 requires to keep working.
    const migration = readFileSync(
      path.resolve(
        process.cwd(),
        'prisma/migrations-pending/20260831170000_commissioner_os_t106_suspension/migration.sql',
      ),
      'utf8',
    )
    const loop = /FOREACH t IN ARRAY ARRAY\[([^\]]+)\]/.exec(migration)
    expect(loop).not.toBeNull()
    const tables = loop![1].split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(tables).toEqual(['TenantUser', 'TenantMember', 'TenantApiKey', 'TenantWebhook'])
    expect(tables).not.toContain('Tenant')
    expect(tables).not.toContain('AuditEvent')
  })
})
