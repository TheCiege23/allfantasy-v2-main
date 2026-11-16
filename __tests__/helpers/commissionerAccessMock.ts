/**
 * Test adapters for lib/league/commissionerAccess.ts (2026-11-16).
 *
 * Route tests that are about something else (a waiver save, a renewal, a playoff edit) used to mock the route's own
 * commissioner check — `assertCommissioner`, `getLeagueRole`, `isCommissioner`, or the league row's owner. When those
 * routes moved onto the shared rule, the mocks stopped intercepting anything. These adapters keep each test deciding
 * "commissioner or not" exactly as it did, through the new module:
 *
 *   vi.mock('@/lib/league/commissionerAccess', async () =>
 *     (await import('../helpers/commissionerAccessMock')).accessFromAssert(() => h.authorize))
 *
 * Each takes a getter rather than the mock itself, so the mock is read at call time (after the test file's own
 * consts exist). Tests whose SUBJECT is the permission rule use the real module (__tests__/league/commissioner-access).
 */
import { NextResponse } from 'next/server'
import { vi } from 'vitest'

type Need = string | readonly string[]
type Decide = (leagueId: string, userId: string | null | undefined, need: Need) => Promise<boolean>

const ALL = ['scoring', 'rosters', 'trades', 'money', 'chat', 'league']

function build(decide: Decide) {
  const commissionerAccessResponse = async (leagueId: string, userId: string | null | undefined, need: Need) =>
    (await decide(leagueId, userId, need)) ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const commissionerAccess = async (leagueId: string, userId: string | null | undefined, need: Need) =>
    (await decide(leagueId, userId, need))
      ? { ok: true as const, role: 'head' as const, scopes: [...ALL] }
      : { ok: false as const, status: 403 as const, error: 'Forbidden' }
  return {
    HEAD_ONLY_MESSAGE: 'Only the head commissioner can do this.',
    NOT_COMMISSIONER_MESSAGE: 'Only the commissioner can do this.',
    commissionerAccess,
    commissionerAccessResponse,
    canCommissionerAct: (leagueId: string, userId: string | null | undefined, need: Need) => decide(leagueId, userId, need),
    assertCommissionerAccess: async (leagueId: string, userId: string | null | undefined, need: Need) => {
      if (!(await decide(leagueId, userId, need))) {
        const err = new Error('Forbidden') as Error & { status?: number }
        err.status = 403
        throw err
      }
      return { league: { id: leagueId, userId, settings: {}, platform: 'native' } as never }
    },
    requireCommissionerAccess: async (leagueId: string, userId: string | null | undefined, need: Need) => {
      const refused = await commissionerAccessResponse(leagueId, userId, need)
      if (refused) throw refused
    },
    readCommissionerStanding: async (leagueId: string, userId: string | null | undefined) => {
      const ok = await decide(leagueId, userId, 'view')
      return { found: true, role: ok ? ('head' as const) : null, scopes: ok ? [...ALL] : [], settings: null }
    },
  }
}

/** The test mocked `assertCommissioner` (resolves = commissioner, rejects = not). */
export function accessFromAssert(get: () => (leagueId: string, userId: string) => Promise<unknown>) {
  return build(async (leagueId, userId) => {
    try {
      await get()(leagueId, String(userId ?? ''))
      return true
    } catch {
      return false
    }
  })
}

/** The test mocked a yes/no check (`isCommissioner`, `isOwnerOrLeagueCommissioner`). */
export function accessFromBoolean(get: () => (leagueId: string, userId: string) => Promise<boolean> | boolean) {
  return build(async (leagueId, userId) => Boolean(await get()(leagueId, String(userId ?? ''))))
}

/** The test mocked `getLeagueRole`. A head-only need passes only for 'commissioner'. */
export function accessFromRole(get: () => (leagueId: string, userId: string) => Promise<string | null> | string | null) {
  return build(async (leagueId, userId, need) => {
    const role = await get()(leagueId, String(userId ?? ''))
    if (need === 'head') return role === 'commissioner'
    return role === 'commissioner' || role === 'co_commissioner'
  })
}

/** The test only fixed the league owner (the route compared `League.userId`). */
export function accessFromOwner(owner: () => string | null | undefined) {
  return build(async (_leagueId, userId) => Boolean(userId) && userId === owner())
}

/** Everyone is a commissioner — for tests whose permission mock already let every caller through. */
export function accessAllowAll() {
  return build(async () => true)
}

const isMock = (fn: unknown): fn is (...a: unknown[]) => unknown =>
  typeof fn === 'function' && 'mock' in (fn as object)

/** A vi.mock factory's module throws on a name it did not return; that is "not mocked", not an error. */
function pick(mod: Record<string, unknown>, name: string): unknown {
  try {
    return mod[name]
  } catch {
    return undefined
  }
}

/**
 * For a test that mocked whichever OLD check its route used — `assertCommissioner`, `isCommissioner`,
 * `getLeagueRole`, `requireCommissionerOnly` / `requireCommissionerRole`, `isElevatedCommissioner`, or devy's own
 * `assertCommissioner` — ask that mock, so the test keeps deciding "commissioner or not" exactly as before.
 * With none of them mocked, the caller is allowed (the test was not about permissions).
 */
export function accessFromLegacyMocks() {
  return build(async (leagueId, userId, need) => {
    const uid = String(userId ?? '')
    const perms = (await import('@/lib/commissioner/permissions')) as Record<string, unknown>
    if (isMock((pick(perms, 'assertCommissioner') as (...a: unknown[]) => unknown))) {
      try { await (pick(perms, 'assertCommissioner') as (...a: unknown[]) => unknown)(leagueId, uid); return true } catch { return false }
    }
    if (isMock((pick(perms, 'isCommissioner') as (...a: unknown[]) => unknown))) return Boolean(await (pick(perms, 'isCommissioner') as (...a: unknown[]) => unknown)(leagueId, uid))
    const lp = (await import('@/lib/league/permissions')) as Record<string, unknown>
    if (isMock((pick(lp, 'getLeagueRole') as (...a: unknown[]) => unknown))) {
      const role = await (pick(lp, 'getLeagueRole') as (...a: unknown[]) => unknown)(leagueId, uid)
      return need === 'head' ? role === 'commissioner' : role === 'commissioner' || role === 'co_commissioner'
    }
    for (const name of ['requireCommissionerOnly', 'requireCommissionerRole']) {
      if (isMock(pick(lp, name))) {
        try { await (pick(lp, name) as (...a: unknown[]) => unknown)(leagueId, uid); return true } catch { return false }
      }
    }
    const ps = (await import('@/server/services/permissionService')) as Record<string, unknown>
    if (isMock((pick(ps, 'isElevatedCommissioner') as (...a: unknown[]) => unknown))) return Boolean(await (pick(ps, 'isElevatedCommissioner') as (...a: unknown[]) => unknown)(leagueId, uid))
    const devy = (await import('@/lib/devy/ai/devyChimmy').catch(() => ({}))) as Record<string, unknown>
    if (isMock((pick(devy, 'assertCommissioner') as (...a: unknown[]) => unknown))) {
      try { await (pick(devy, 'assertCommissioner') as (...a: unknown[]) => unknown)(leagueId, uid); return true } catch { return false }
    }
    return true
  })
}

/**
 * For a test that runs the REAL `getLeagueRole` over its own prisma mocks (league owner + team flags): the same
 * real function decides, so the test keeps pinning who may act.
 */
export function accessFromRealRole() {
  return build(async (leagueId, userId, need) => {
    const actual = (await vi.importActual('@/lib/league/permissions')) as { getLeagueRole: (l: string, u: string) => Promise<string | null> }
    const role = await actual.getLeagueRole(leagueId, String(userId ?? ''))
    if (need === 'head') return role === 'commissioner'
    return role === 'commissioner' || role === 'co_commissioner'
  })
}
