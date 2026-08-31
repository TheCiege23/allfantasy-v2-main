/**
 * Commissioner OS · T-003 acceptance — ActorContext construction.
 *
 * The type-level half of the criterion ("cannot be constructed without
 * tenantId — enforced at the type level, not by convention") is proved in
 * `actorContext.types.ts`, which is typechecked rather than run. Vitest does
 * not typecheck, so a `@ts-expect-error` asserted only here would be a check
 * that cannot fail. This file covers what happens at RUNTIME, which types
 * cannot reach: an empty string, a whitespace-only string, header handling.
 */

import { describe, it, expect } from 'vitest'
import {
  actorContextFromRequest,
  createActorContext,
  syntheticIntegrationActor,
} from '@/lib/domain/actorContext'

const VALID = {
  userId: 'user_1',
  actorLabel: 'Dana Okafor',
  tenantId: 'tenant_dynastyco',
} as const

function headers(map: Record<string, string>) {
  return { headers: { get: (n: string) => map[n.toLowerCase()] ?? null } }
}

describe('T-003 · createActorContext', () => {
  it('builds a context and defaults the three role axes to null', () => {
    const r = createActorContext(VALID)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Null, not undefined, and not absent. Three independent axes that are
    // each explicitly "no role here" — an absent key would let a permission
    // check read `undefined` and treat it as "not yet resolved".
    expect(r.value.platformRole).toBeNull()
    expect(r.value.tenantRole).toBeNull()
    expect(r.value.leagueRole).toBeNull()
  })

  it('keeps all three axes independent', () => {
    // Not collapsible into one enum: a person can hold all three at once, and a
    // single enum forces a precedence order that is wrong for someone.
    const r = createActorContext({
      ...VALID,
      platformRole: 'PLATFORM_SUPPORT',
      tenantRole: 'TENANT_ADMIN',
      leagueRole: 'COMMISSIONER',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.platformRole).toBe('PLATFORM_SUPPORT')
    expect(r.value.tenantRole).toBe('TENANT_ADMIN')
    expect(r.value.leagueRole).toBe('COMMISSIONER')
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
  ])('refuses a %s tenantId', (_label, tenantId) => {
    // The compiler guarantees tenantId is PRESENT; it cannot guarantee it is
    // non-empty, and empty is the dangerous case. withTenant would write '' into
    // app.tenant_id, TENANCY.md §3.2's nullif(…, '') guard would match NOTHING,
    // and the operator sees an empty database rather than an error.
    const r = createActorContext({ ...VALID, tenantId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVARIANT')
    expect(r.error).toMatchObject({ invariant: 'actorContext.required' })
    expect(r.error.detail).toContain('tenantId')
  })

  it('explains WHY an empty tenantId is refused', () => {
    // A refusal that just says "required" sends someone looking for a missing
    // field. This one has to say that the failure mode is an apparently-empty
    // database, because that is what they would otherwise be debugging.
    const r = createActorContext({ ...VALID, tenantId: '' })
    if (r.ok) throw new Error('expected failure')
    expect(r.error.detail).toMatch(/matches no rows|empty database/i)
  })

  it.each(['userId', 'actorLabel'] as const)('refuses an empty %s', (field) => {
    const r = createActorContext({ ...VALID, [field]: '' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.detail).toContain(field)
  })

  it('names every missing field at once, not just the first', () => {
    // One round trip per missing field is how a five-field form takes five
    // submissions to fill in.
    const r = createActorContext({ userId: '', actorLabel: '', tenantId: '' })
    if (r.ok) throw new Error('expected failure')
    expect(r.error.detail).toContain('userId')
    expect(r.error.detail).toContain('actorLabel')
    expect(r.error.detail).toContain('tenantId')
  })

  it('generates a requestId when none is supplied', () => {
    const r = createActorContext(VALID)
    if (!r.ok) throw new Error('expected success')
    expect(r.value.requestId).toBeTruthy()
  })

  it('generates a requestId rather than accepting a blank one', () => {
    // A blank requestId silently un-correlates a request's audit rows from its
    // logs — the failure shows up months later when someone tries to trace an
    // incident and the join returns nothing.
    const r = createActorContext({ ...VALID, requestId: '   ' })
    if (!r.ok) throw new Error('expected success')
    expect(r.value.requestId.trim()).not.toBe('')
  })

  it('gives two contexts different requestIds', () => {
    const a = createActorContext(VALID)
    const b = createActorContext(VALID)
    if (!a.ok || !b.ok) throw new Error('expected success')
    expect(a.value.requestId).not.toBe(b.value.requestId)
  })

  it('omits optional fields rather than setting them undefined', () => {
    const r = createActorContext(VALID)
    if (!r.ok) throw new Error('expected success')
    expect('onBehalfOfLeagueId' in r.value).toBe(false)
    expect('reason' in r.value).toBe(false)
  })

  it('keeps the actor’s own userId when acting on a league’s behalf', () => {
    // Impersonation that rewrites the actor is banned: an audit row must never
    // appear to have been written by someone who did not write it.
    const r = createActorContext({ ...VALID, onBehalfOfLeagueId: 'league_9' })
    if (!r.ok) throw new Error('expected success')
    expect(r.value.userId).toBe('user_1')
    expect(r.value.onBehalfOfLeagueId).toBe('league_9')
  })
})

describe('T-003 · actorContextFromRequest', () => {
  it('takes the request id from the header so a trace survives the proxy hop', () => {
    const r = actorContextFromRequest(headers({ 'x-request-id': 'req-abc' }), VALID)
    if (!r.ok) throw new Error('expected success')
    expect(r.value.requestId).toBe('req-abc')
  })

  it('generates one when the header is absent', () => {
    const r = actorContextFromRequest(headers({}), VALID)
    if (!r.ok) throw new Error('expected success')
    expect(r.value.requestId).toBeTruthy()
  })

  it('carries the reason header without validating it', () => {
    // T-004 owns the rules (>= 12 chars, not the action name, not stoplisted).
    // Duplicating them here would give two answers to one question, and the two
    // would drift.
    const r = actorContextFromRequest(headers({ 'x-commish-reason': 'no' }), VALID)
    if (!r.ok) throw new Error('expected success')
    expect(r.value.reason).toBe('no')
  })

  it('does NOT read onBehalfOfLeagueId from a header', () => {
    // Act-as is a privilege, and a privilege assertable by adding a header is
    // not a privilege. It arrives through identity, where its grant is auditable.
    const r = actorContextFromRequest(
      headers({ 'x-commish-on-behalf-of-league': 'league_stolen' }),
      VALID,
    )
    if (!r.ok) throw new Error('expected success')
    expect(r.value.onBehalfOfLeagueId).toBeUndefined()
  })

  it('propagates a validation failure from the identity it was given', () => {
    const r = actorContextFromRequest(headers({}), { ...VALID, tenantId: '' })
    expect(r.ok).toBe(false)
  })
})

describe('T-003 · syntheticIntegrationActor', () => {
  it('holds no roles on any axis', () => {
    // A provider can never trigger an action the matrix would deny a human. The
    // cheapest way to hold that is to give integration strictly LESS authority
    // than any person, rather than equal authority under a different name.
    const r = syntheticIntegrationActor('tenant_dynastyco', 'sleeper')
    if (!r.ok) throw new Error('expected success')
    expect(r.value.platformRole).toBeNull()
    expect(r.value.tenantRole).toBeNull()
    expect(r.value.leagueRole).toBeNull()
  })

  it('is identifiable as sync rather than as a person', () => {
    const r = syntheticIntegrationActor('tenant_dynastyco', 'sleeper')
    if (!r.ok) throw new Error('expected success')
    expect(r.value.userId).toBe('integration:sleeper')
    expect(r.value.actorLabel).toContain('sleeper')
  })

  it('is still tenant-scoped', () => {
    const r = syntheticIntegrationActor('', 'sleeper')
    expect(r.ok).toBe(false)
  })
})
