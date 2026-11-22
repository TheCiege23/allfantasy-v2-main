// @vitest-environment node
/**
 * The one commissioner rule (lib/league/commissionerAccess.ts, 2026-11-16): the head commissioner always; a
 * co-commissioner only in the areas the head commissioner granted; head-only actions stay head-only. Plus the routes
 * whose holes it closed, and the scope-key fix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Team = { id: string; claimedByUserId: string; isCommissioner?: boolean; isCoCommissioner?: boolean; role?: string }
const h = vi.hoisted(() => ({
  owner: 'owner',
  settings: {} as Record<string, unknown>,
  teams: [] as Array<{ id: string; claimedByUserId: string; isCommissioner?: boolean; isCoCommissioner?: boolean; role?: string }>,
  found: true,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async (args: { select: { teams?: { where: { claimedByUserId: string } } } }) => {
        if (!h.found) return null
        const uid = args.select.teams?.where.claimedByUserId
        return {
          userId: h.owner,
          settings: h.settings,
          teams: h.teams
            .filter((t) => t.claimedByUserId === uid)
            .map((t) => ({ id: t.id, isCommissioner: Boolean(t.isCommissioner), isCoCommissioner: Boolean(t.isCoCommissioner), role: t.role ?? 'member' })),
        }
      }),
    },
  },
}))

import { canCommissionerAct, commissionerAccess, commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { scopeForSettingsKey, scopesForSettingsPatch } from '@/lib/league/coCommissionerScopes'

const seat = (t: Team) => h.teams.push(t)

beforeEach(() => {
  h.owner = 'owner'
  h.settings = {}
  h.teams = []
  h.found = true
})

describe('who may act', () => {
  it('the owner and a claimed head-commissioner team may do anything, head-only included', async () => {
    expect(await commissionerAccess('L', 'owner', 'head')).toMatchObject({ ok: true, role: 'head' })
    seat({ id: 't-head', claimedByUserId: 'imported-head', isCommissioner: true })
    expect(await commissionerAccess('L', 'imported-head', 'money')).toMatchObject({ ok: true, role: 'head' })
    expect(await commissionerAccess('L', 'imported-head', 'head')).toMatchObject({ ok: true })
  })

  it('a co-commissioner nobody configured holds every area, but never head-only actions', async () => {
    seat({ id: 'co', claimedByUserId: 'co-user', isCoCommissioner: true })
    for (const need of ['scoring', 'rosters', 'trades', 'money', 'chat', 'league', 'view'] as const) {
      expect((await commissionerAccess('L', 'co-user', need)).ok).toBe(true)
    }
    expect(await commissionerAccess('L', 'co-user', 'head')).toMatchObject({ ok: false, status: 403, error: 'Only the head commissioner can do this.' })
  })

  it('a configured co-commissioner may act only in the areas granted, and is told which is missing', async () => {
    seat({ id: 'co', claimedByUserId: 'co-user', isCoCommissioner: true })
    h.settings = { co_commissioner_scopes: { co: ['scoring', 'chat'] } }
    expect((await commissionerAccess('L', 'co-user', 'scoring')).ok).toBe(true)
    expect(await commissionerAccess('L', 'co-user', 'rosters')).toMatchObject({ ok: false, status: 403, missingScopes: ['rosters'] })
    expect(await commissionerAccess('L', 'co-user', ['scoring', 'trades'])).toMatchObject({ ok: false, missingScopes: ['trades'] })
    expect((await commissionerAccess('L', 'co-user', ['scoring', 'chat'])).ok).toBe(true)
    const res = await commissionerAccessResponse('L', 'co-user', 'money')
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({
      error: 'The head commissioner hasn’t given you money permission in this league.',
      code: 'co_commissioner_scope',
      missingScopes: ['money'],
    })
  })

  it('an empty grant is view only', async () => {
    seat({ id: 'co', claimedByUserId: 'co-user', isCoCommissioner: true })
    h.settings = { co_commissioner_scopes: { co: [] } }
    expect((await commissionerAccess('L', 'co-user', 'view')).ok).toBe(true)
    expect((await commissionerAccess('L', 'co-user', 'league')).ok).toBe(false)
  })

  it('two co-commissioner seats: either seat holding the area is enough', async () => {
    seat({ id: 'co1', claimedByUserId: 'co-user', isCoCommissioner: true })
    seat({ id: 'co2', claimedByUserId: 'co-user', isCoCommissioner: true })
    h.settings = { co_commissioner_scopes: { co1: ['scoring'], co2: ['trades'] } }
    expect((await commissionerAccess('L', 'co-user', 'trades')).ok).toBe(true)
    expect((await commissionerAccess('L', 'co-user', 'money')).ok).toBe(false)
  })

  it('a tournament-granted co-commissioner holds every area without a team, but not head-only', async () => {
    h.settings = { tournamentCoCommissionerIds: ['tc'] }
    expect(await commissionerAccess('L', 'tc', 'money')).toMatchObject({ ok: true, role: 'co_commissioner' })
    expect((await commissionerAccess('L', 'tc', 'head')).ok).toBe(false)
  })

  it('a member, a viewer seat, and nobody are refused; a missing league is a 404', async () => {
    seat({ id: 'm', claimedByUserId: 'member' })
    seat({ id: 'v', claimedByUserId: 'viewer', isCoCommissioner: true, role: 'viewer' })
    expect(await commissionerAccess('L', 'member', 'view')).toMatchObject({ ok: false, status: 403 })
    expect(await commissionerAccess('L', 'viewer', 'view')).toMatchObject({ ok: false, status: 403 })
    expect(await canCommissionerAct('L', null, 'view')).toBe(false)
    h.found = false
    expect(await commissionerAccess('L', 'owner', 'view')).toMatchObject({ ok: false, status: 404 })
  })
})

describe('settings keys file under the right area', () => {
  it('playoff keys containing "ir" are league setup, not rosters; IR keys are rosters', () => {
    expect(['thirdPlaceGame', 'playoff_third_place', 'firstPlaceBye', 'fairPlay'].map(scopeForSettingsKey)).toEqual(['league', 'league', 'league', 'league'])
    expect(['irSlots', 'IR_slots', 'maxIr', 'hasIrSlot', 'irEligible'].map(scopeForSettingsKey)).toEqual(['rosters', 'rosters', 'rosters', 'rosters', 'rosters'])
  })

  it('pick terms are a trade rule', () => {
    expect(scopeForSettingsKey('pick_terms_rule')).toBe('trades')
    expect(scopesForSettingsPatch({ settingsMerge: { pick_terms_rule: 'x', thirdPlaceGame: true } })).toEqual(['trades', 'league'])
  })
})
