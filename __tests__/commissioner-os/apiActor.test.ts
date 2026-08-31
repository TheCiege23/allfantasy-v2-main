/**
 * Commissioner OS · T-112 acceptance.
 *
 * "A scoped key is refused an action outside its scopes."
 *
 * Plus the property that makes that meaningful: the scope check is an
 * INTERSECTION with the role check, not a replacement for it. A test that only
 * showed scopes being enforced would pass for a design where a key with
 * `leagues:write` can do anything at all, provided it names the right scope.
 */

import { describe, it, expect } from 'vitest'
import { API_ACTOR_PREFIX, apiActorContext, apiKeyIdOf, isApiActor } from '@/lib/domain/apiActor'
import {
  ACTION_KEYS,
  API_SCOPES,
  PERMISSION_MATRIX,
  type ActionKey,
  authorize,
} from '@/lib/domain/authorize'
import { createActorContext, type ActorContext } from '@/lib/domain/actorContext'

const key = (over: Record<string, unknown> = {}) => ({
  tenantId: 't1',
  keyId: 'k1',
  label: 'CI deploy key',
  role: 'TENANT_ADMIN' as const,
  scopes: ['leagues:write'],
  ...over,
})

function ctxFor(over: Record<string, unknown> = {}): ActorContext {
  const r = apiActorContext(key(over) as any)
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

const allow = (ctx: ActorContext, action: ActionKey, resource: unknown = null) =>
  authorize({ ctx, requires: action, resource })

describe('T-112 · the API actor', () => {
  it('gets a synthetic, attributable userId', () => {
    // ActorContext.userId is required and non-empty by design — an
    // unattributable audit row is the one thing the trail cannot recover from.
    const ctx = ctxFor()
    expect(ctx.userId).toBe(`${API_ACTOR_PREFIX}k1`)
    expect(isApiActor(ctx)).toBe(true)
    expect(apiKeyIdOf(ctx)).toBe('k1')
  })

  it('uses the key label so audit reads as something', () => {
    expect(ctxFor().actorLabel).toBe('CI deploy key')
  })

  it('falls back to the id rather than a blank label', () => {
    // createActorContext rejects an empty actorLabel, so a key with no label
    // would otherwise fail to authenticate at all.
    expect(ctxFor({ label: '' }).actorLabel).toContain('k1')
  })

  it('🛑 never carries a platform role', () => {
    // Platform authority belongs to people holding a PlatformGrant. An API key
    // is a tenant's credential and must never be a route to cross-tenant
    // access — the T-105 boundary would otherwise have a second door.
    const ctx = ctxFor({ role: 'TENANT_OWNER' })
    expect(ctx.platformRole).toBeNull()
    expect(allow(ctx, 'tenant.crossTenantRead').ok).toBe(false)
  })

  it('never carries a league role', () => {
    expect(ctxFor().leagueRole).toBeNull()
  })

  it('a human context has apiScopes undefined, not empty', () => {
    // ⚠ THE DISTINCTION IS LOAD-BEARING. `undefined` skips the scope check;
    // `[]` is a key delegated nothing. Collapsing them either locks every human
    // out or makes every key unscoped.
    const human = createActorContext({
      userId: 'u1',
      actorLabel: 'Dana',
      tenantId: 't1',
      tenantRole: 'TENANT_ADMIN',
    })
    if (!human.ok) throw new Error('bad fixture')
    expect(human.value.apiScopes).toBeUndefined()
    expect('apiScopes' in human.value).toBe(false)
  })

  it('an API context with no scopes has [] and keeps it', () => {
    const ctx = ctxFor({ scopes: [] })
    expect(ctx.apiScopes).toEqual([])
    expect(ctx.apiScopes).not.toBeUndefined()
  })
})

describe('T-112 · 🛑 a scoped key is refused an action outside its scopes', () => {
  it('is granted the action its scope covers (positive control)', () => {
    // Without this, the refusal below could mean "an API key can do nothing" —
    // and the test would pass for entirely the wrong reason.
    const ctx = ctxFor({ scopes: ['leagues:write'] })
    expect(allow(ctx, 'league.settings.update', { tenantId: 't1' }).ok).toBe(true)
  })

  it('is refused an action outside its scopes, despite holding the role', () => {
    // TENANT_ADMIN grants tenant.member.invite by role. The key does not hold
    // `members:write`, so it is refused anyway.
    const ctx = ctxFor({ scopes: ['leagues:write'] })
    const r = allow(ctx, 'tenant.member.invite')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('FORBIDDEN')
    expect(r.error).toMatchObject({ because: expect.stringContaining('members:write') })
  })

  it('a key with NO scopes can do nothing, whatever its role', () => {
    const ctx = ctxFor({ role: 'TENANT_OWNER', scopes: [] })
    for (const action of ACTION_KEYS) {
      expect(allow(ctx, action, { tenantId: 't1' }).ok, `${action} was granted`).toBe(false)
    }
  })

  it('a key with EVERY scope still cannot exceed its role', () => {
    // 🛑 THE INTERSECTION, ASSERTED FROM THE OTHER SIDE. Scopes alone would let
    // this key do everything it names. TENANT_SUPPORT holds no write action, so
    // every write is refused however generous the scopes.
    const ctx = ctxFor({ role: 'TENANT_SUPPORT', scopes: [...API_SCOPES] })
    const writes = ACTION_KEYS.filter((a) => PERMISSION_MATRIX[a].write)
    for (const action of writes) {
      expect(allow(ctx, action, { tenantId: 't1' }).ok, `${action} was granted`).toBe(false)
    }
  })

  it('a support key keeps the reads its role allows', () => {
    // The other half — otherwise "TENANT_SUPPORT can do nothing" would satisfy
    // the test above while making the role useless.
    const ctx = ctxFor({ role: 'TENANT_SUPPORT', scopes: ['audit:read'] })
    expect(allow(ctx, 'audit.read', { tenantId: 't1' }).ok).toBe(true)
  })
})

describe('T-112 · actions with no declared scope are closed to keys', () => {
  const closed = ACTION_KEYS.filter((a) => !PERMISSION_MATRIX[a].apiScope)

  it('there are some (positive control)', () => {
    expect(closed.length).toBeGreaterThan(0)
  })

  it.each(closed)('%s is refused even to a key holding every scope', (action) => {
    // ⚠ ABSENT MEANS "NOT REACHABLE BY AN API KEY", NOT "NO SCOPE NEEDED".
    // An action added next year without thinking about API access is closed
    // until someone decides otherwise — the opposite of the default that would
    // make a new destructive action reachable by every existing key on the day
    // it ships.
    const ctx = ctxFor({ role: 'TENANT_OWNER', scopes: [...API_SCOPES] })
    expect(allow(ctx, action, { tenantId: 't1' }).ok).toBe(false)
  })

  it('the irreversible and cross-tenant actions are among them', () => {
    // Pinned by name: purge and cross-tenant read must never become reachable
    // by a leaked build secret.
    expect(closed).toContain('data.purgeLeague')
    expect(closed).toContain('data.readDeleted')
    expect(closed).toContain('tenant.delete')
    expect(closed).toContain('tenant.crossTenantRead')
  })
})

describe('T-112 · the scope vocabulary is coherent', () => {
  it('every declared apiScope is a real scope', () => {
    // A typo'd scope name is unreachable — no key can ever hold it — so the
    // action silently becomes closed to the API while looking open.
    for (const action of ACTION_KEYS) {
      const scope = PERMISSION_MATRIX[action].apiScope
      if (!scope) continue
      expect(API_SCOPES, `${action} declares unknown scope ${scope}`).toContain(scope)
    }
  })

  it('every scope in the vocabulary is used by at least one action', () => {
    // An unused scope is one an issuer can grant that does nothing — it reads
    // as delegation and delegates nothing.
    const used = new Set(ACTION_KEYS.map((a) => PERMISSION_MATRIX[a].apiScope).filter(Boolean))
    const unused = API_SCOPES.filter((s) => !used.has(s))
    expect(unused, `scopes nothing uses: ${unused.join(', ')}`).toEqual([])
  })

  it('a write action never sits behind a :read scope', () => {
    // `audit:read` granting a write would make the naming a lie, and the naming
    // is what an issuer reads when ticking a box.
    for (const action of ACTION_KEYS) {
      const rule = PERMISSION_MATRIX[action]
      if (!rule.write || !rule.apiScope) continue
      expect(rule.apiScope.endsWith(':read'), `${action} is a write behind ${rule.apiScope}`).toBe(
        false,
      )
    }
  })
})

describe('T-112 · human sessions are unaffected', () => {
  it('a human with the role is granted, with no scopes anywhere', () => {
    const human = createActorContext({
      userId: 'u1',
      actorLabel: 'Dana',
      tenantId: 't1',
      tenantRole: 'TENANT_ADMIN',
    })
    if (!human.ok) throw new Error('bad fixture')
    expect(allow(human.value, 'tenant.member.invite').ok).toBe(true)
  })

  it('a human can reach actions closed to API keys', () => {
    const human = createActorContext({
      userId: 'u1',
      actorLabel: 'Dana',
      tenantId: 't1',
      tenantRole: 'TENANT_OWNER',
      reason: 'Closing the account at the operator’s written request.',
    })
    if (!human.ok) throw new Error('bad fixture')
    expect(allow(human.value, 'tenant.delete').ok).toBe(true)
  })
})
