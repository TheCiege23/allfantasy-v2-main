/**
 * Commissioner OS · T-104 acceptance.
 *
 * "One test per matrix row. A test proving `TENANT_ADMIN` cannot act on another
 * tenant's league even with a valid league ID. A test proving `TENANT_SUPPORT`
 * has no write actions at all."
 *
 * "One test per matrix row" is driven off `ACTION_KEYS` rather than written out
 * by hand. A hand-written list covers the rows that existed when someone wrote
 * it; a data-driven one covers the row added in month eight, which is the one
 * nobody would have written a test for.
 *
 * ⚠ EACH ROW IS ASSERTED IN BOTH DIRECTIONS — every declared role is granted,
 * AND every undeclared role is refused. Testing only the grants would pass for
 * a matrix that allows everyone everything.
 */

import { describe, it, expect } from 'vitest'
import {
  ACTION_KEYS,
  PERMISSION_MATRIX,
  type ActionKey,
  actionRequiresReason,
  allowedActions,
  authorize,
  createAuthorize,
} from '@/lib/domain/authorize'
import { createActorContext, type ActorContext } from '@/lib/domain/actorContext'
import { LEAGUE_ROLES, PLATFORM_ROLES, TENANT_ROLES } from '@/lib/domain/roles'

const TENANT = 't1'

function actor(over: Record<string, unknown> = {}): ActorContext {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Dana',
    tenantId: TENANT,
    ...over,
  } as any)
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

const allow = (ctx: ActorContext, action: ActionKey, resource: unknown = null) =>
  authorize({ ctx, requires: action, resource })

describe('T-104 · the matrix is exhaustive and coherent', () => {
  it('has a row for every action key (positive control)', () => {
    // Without this, ACTION_KEYS could be empty and every data-driven test below
    // would pass having asserted nothing.
    expect(ACTION_KEYS.length).toBeGreaterThan(10)
    for (const key of ACTION_KEYS) expect(PERMISSION_MATRIX[key]).toBeDefined()
  })

  it('🛑 the matrix keys are EXACTLY the action keys, at runtime', () => {
    // The type already makes a missing row a compile error. This makes that
    // guarantee un-bypassable, and it exists because a positive control caught
    // the type-level proof being insufficient on its own: widening the matrix
    // to `Record<string, ActionRule>` typechecked clean, because the fixture
    // asserted about `Record<ActionKey, ActionRule>` rather than about how this
    // matrix is actually annotated.
    //
    // ACTION_KEYS is now a runtime array with ActionKey derived FROM it, so a
    // row missing from the matrix — or an extra one — fails here whatever the
    // annotation says.
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...ACTION_KEYS].sort())
  })

  it('declares no duplicate action keys', () => {
    // A duplicate in the array silently shadows: the later literal wins in the
    // object, and the earlier one is a key nothing can ever reach.
    expect(new Set(ACTION_KEYS).size).toBe(ACTION_KEYS.length)
  })

  it.each(ACTION_KEYS)('%s grants at least one role', (action) => {
    // A row granting nobody is unreachable — and it is indistinguishable from
    // a correctly-restrictive rule until someone needs it.
    const rule = PERMISSION_MATRIX[action]
    const total =
      (rule.platform?.length ?? 0) + (rule.tenant?.length ?? 0) + (rule.league?.length ?? 0)
    expect(total, `${action} grants nobody`).toBeGreaterThan(0)
  })

  it.each(ACTION_KEYS)('%s names only real roles', (action) => {
    // A typo'd role name silently grants nobody, which reads as a deliberate
    // restriction rather than as a mistake.
    const rule = PERMISSION_MATRIX[action]
    for (const r of rule.platform ?? []) expect(PLATFORM_ROLES).toContain(r)
    for (const r of rule.tenant ?? []) expect(TENANT_ROLES).toContain(r)
    for (const r of rule.league ?? []) expect(LEAGUE_ROLES).toContain(r)
  })

  it('platform scope is exactly the four actions TENANCY.md §6 reserves', () => {
    // "Platform keeps: tenant provisioning, suspension, plan changes,
    // cross-tenant reads." Pinned by name so a fifth cannot drift in — the
    // whole §6 rewrite is about actions moving OUT of platform scope.
    const platformScoped = ACTION_KEYS.filter((k) => PERMISSION_MATRIX[k].scope === 'platform')
    expect(platformScoped.sort()).toEqual([
      'tenant.changePlan',
      'tenant.crossTenantRead',
      'tenant.provision',
      'tenant.suspend',
    ])
  })
})

// ─── One test per row, both directions ───────────────────────────────────────

describe('T-104 · every matrix row, every role', () => {
  it.each(ACTION_KEYS)('%s: declared roles are granted', (action) => {
    const rule = PERMISSION_MATRIX[action]
    for (const role of rule.platform ?? []) {
      expect(allow(actor({ platformRole: role }), action).ok, `platform ${role}`).toBe(true)
    }
    for (const role of rule.tenant ?? []) {
      expect(allow(actor({ tenantRole: role }), action).ok, `tenant ${role}`).toBe(true)
    }
    for (const role of rule.league ?? []) {
      expect(allow(actor({ leagueRole: role }), action).ok, `league ${role}`).toBe(true)
    }
  })

  it.each(ACTION_KEYS)('%s: undeclared roles are refused', (action) => {
    const rule = PERMISSION_MATRIX[action]
    for (const role of PLATFORM_ROLES) {
      if (rule.platform?.includes(role)) continue
      expect(allow(actor({ platformRole: role }), action).ok, `platform ${role}`).toBe(false)
    }
    for (const role of TENANT_ROLES) {
      if (rule.tenant?.includes(role)) continue
      expect(allow(actor({ tenantRole: role }), action).ok, `tenant ${role}`).toBe(false)
    }
    for (const role of LEAGUE_ROLES) {
      if (rule.league?.includes(role)) continue
      expect(allow(actor({ leagueRole: role }), action).ok, `league ${role}`).toBe(false)
    }
  })

  it.each(ACTION_KEYS)('%s: an actor with no roles at all is refused', (action) => {
    expect(allow(actor(), action).ok).toBe(false)
  })
})

// ─── The two named acceptance criteria ───────────────────────────────────────

describe('T-104 · TENANT_SUPPORT has no write actions at all', () => {
  it('holds zero write permissions', () => {
    // Asserted over the WHOLE matrix rather than per action, because the
    // property is about the role: a per-action test would miss the write row
    // someone adds to TENANT_SUPPORT later.
    const support = actor({ tenantRole: 'TENANT_SUPPORT' })
    const writes = allowedActions(support).filter((a) => PERMISSION_MATRIX[a].write)
    expect(writes, `TENANT_SUPPORT was granted write actions: ${writes.join(', ')}`).toEqual([])
  })

  it('still holds the reads that make it useful', () => {
    // The other half. A support role with nothing at all is not read-only
    // staff, it is a role nobody can use — and the fix someone reaches for is
    // to grant it a write.
    const reads = allowedActions(actor({ tenantRole: 'TENANT_SUPPORT' }))
    expect(reads).toContain('audit.read')
    expect(reads).toContain('data.readDeleted')
  })
})

describe('T-104 · TENANT_ADMIN cannot act on another tenant’s league', () => {
  const admin = actor({ tenantRole: 'TENANT_ADMIN' })

  it('is granted on its OWN tenant’s league (positive control)', () => {
    // Without this, the refusal below could be "TENANT_ADMIN cannot do this at
    // all" rather than "not across tenants" — and the test would pass for
    // entirely the wrong reason.
    const result = allow(admin, 'league.settings.update', { id: 'l1', tenantId: TENANT })
    expect(result.ok).toBe(true)
  })

  it('🛑 is refused on another tenant’s league, with a valid league ID', () => {
    const result = allow(admin, 'league.settings.update', { id: 'l1', tenantId: 'other-tenant' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
    expect(result.error).toMatchObject({ because: expect.stringContaining('different tenant') })
  })

  it('the cross-tenant refusal outranks the role check', () => {
    // A TENANT_OWNER — the most privileged tenant role — is refused just the
    // same. Checking the role first would let the refusal REASON differ by
    // role, which is a probe for which roles exist.
    const owner = actor({ tenantRole: 'TENANT_OWNER' })
    const result = allow(owner, 'league.settings.update', { tenantId: 'other-tenant' })
    expect(result.ok).toBe(false)
  })

  it('a platform admin is refused too, without the cross-tenant action', () => {
    // Platform staff do not get cross-tenant access by being platform staff.
    // TENANCY.md §3.3: it is a ROLE with its own connection pool and an audited
    // action, not an attribute of being important.
    const platform = actor({ platformRole: 'PLATFORM_ADMIN' })
    expect(allow(platform, 'league.settings.update', { tenantId: 'other' }).ok).toBe(false)
  })

  it('resources with no tenantId are not blocked by the check', () => {
    // Not everything is tenant-owned. A rule that refused every untenanted
    // resource would break platform-scope actions entirely.
    expect(allow(actor({ platformRole: 'PLATFORM_ADMIN' }), 'tenant.provision', null).ok).toBe(true)
    expect(allow(actor({ platformRole: 'PLATFORM_ADMIN' }), 'tenant.provision', {}).ok).toBe(true)
  })
})

// ─── Failing closed ──────────────────────────────────────────────────────────

describe('T-104 · unknown actions fail closed', () => {
  it('refuses a key that is not in the matrix', () => {
    // Unreachable from typed call sites — the exhaustive Record sees to that.
    // This is for the untyped ones: an API-key scope string, a value off the
    // wire, a typo. A miss must be a refusal, never a silent allow.
    const result = authorize({
      ctx: actor({ platformRole: 'PLATFORM_ADMIN' }),
      requires: 'tenant.provisionn',
      resource: null,
    })
    expect(result.ok).toBe(false)
  })

  it('an empty matrix grants nothing', () => {
    const empty = createAuthorize({} as any)
    const result = empty({
      ctx: actor({ platformRole: 'PLATFORM_ADMIN' }),
      requires: 'tenant.provision',
      resource: null,
    })
    expect(result.ok).toBe(false)
  })
})

// ─── The axes stay independent ───────────────────────────────────────────────

describe('T-104 · the three axes do not collapse', () => {
  it('holding a role on ANY granting axis is sufficient', () => {
    // league.settings.update grants COMMISSIONER (league) and TENANT_ADMIN
    // (tenant). Either alone works.
    expect(allow(actor({ leagueRole: 'COMMISSIONER' }), 'league.settings.update').ok).toBe(true)
    expect(allow(actor({ tenantRole: 'TENANT_ADMIN' }), 'league.settings.update').ok).toBe(true)
  })

  it('a role on a non-granting axis does not help', () => {
    // A MANAGER is a league role; it is not a quieter tenant role.
    expect(allow(actor({ leagueRole: 'MANAGER' }), 'league.settings.update').ok).toBe(false)
  })

  it('holding all three is not special-cased', () => {
    const everything = actor({
      platformRole: 'PLATFORM_SUPPORT',
      tenantRole: 'TENANT_SUPPORT',
      leagueRole: 'MANAGER',
    })
    // None of those three grants it, and holding all three still does not.
    expect(allow(everything, 'league.settings.update').ok).toBe(false)
  })
})

// ─── Reason requirements line up with the other tickets ──────────────────────

describe('T-104 · reason-required actions', () => {
  it('every irreversible or cross-tenant action requires a reason', () => {
    for (const action of [
      'tenant.suspend',
      'tenant.crossTenantRead',
      'tenant.delete',
      'data.readDeleted',
      'data.purgeLeague',
      'tenant.export',
    ] as ActionKey[]) {
      expect(actionRequiresReason(action), `${action} should require a reason`).toBe(true)
    }
  })

  it('routine actions do not', () => {
    // If everything required a reason, nobody would write a real one — the
    // stoplist in T-004 exists because that is what people do under friction.
    expect(actionRequiresReason('analytics.read')).toBe(false)
    expect(actionRequiresReason('tenant.member.invite')).toBe(false)
  })

  it('data.readDeleted matches what T-006 enforces', () => {
    // T-006's withDeleted names platform and tenant-support only. If this row
    // ever widened, that escape would widen with it silently.
    const rule = PERMISSION_MATRIX['data.readDeleted']
    expect(rule.tenant).toEqual(['TENANT_SUPPORT'])
    expect(rule.league).toBeUndefined()
    expect(rule.write).toBe(false)
  })

  it('data.purgeLeague is the narrowest write in the matrix', () => {
    // The only irreversible action. Platform admin or the operator's owner —
    // never an admin, never a commissioner.
    const rule = PERMISSION_MATRIX['data.purgeLeague']
    expect(rule.platform).toEqual(['PLATFORM_ADMIN'])
    expect(rule.tenant).toEqual(['TENANT_OWNER'])
    expect(rule.league).toBeUndefined()
  })
})
