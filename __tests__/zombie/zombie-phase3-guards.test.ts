// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Weapons, bombs, ambushes and powers used to be SPENT for nothing: marked used, announced as active, and
 * applied by no engine. They are now refused without spending; serums — which really work — still go
 * through. The items POST route, which could spend any item (a serum included) with no effect, refuses too.
 */

const h = vi.hoisted(() => ({
  serum: vi.fn(async () => ({ id: 'a1', isValid: true, publicResponse: 'registered', privateResponse: 'ok', validationError: null })),
  revive: vi.fn(async () => undefined),
  itemUpdate: vi.fn(),
  itemFindFirst: vi.fn(),
  weapon: vi.fn(async () => ({ id: 'weapon-action', isValid: true, publicResponse: 'weapon used', privateResponse: null, validationError: null })),
  ambush: vi.fn(async () => ({ id: 'ambush-action', isValid: true, publicResponse: 'ambush set', privateResponse: null, validationError: null })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/zombie/serumEngine', () => ({ processSerumAction: h.serum, processRevive: h.revive }))
vi.mock('@/lib/zombie/weaponEngine', () => ({ processWeaponAction: h.weapon }))
vi.mock('@/lib/zombie/ambushEngine', () => ({ processAmbushFromChimmy: h.ambush }))
vi.mock('@/lib/zombie/ZombieHordeSitOutEngine', () => ({
  applyZombieHordeSitOutToChallenges: vi.fn(async () => ({ blocked: false })),
  nominateZombieHordeSitOut: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieTeamItem: { update: h.itemUpdate, findFirst: h.itemFindFirst },
    zombieChimmyAction: { create: vi.fn(async () => ({ id: 'x' })) },
    roster: { findFirst: vi.fn(async () => ({ id: 'R1' })) },
    zombieLeagueTeam: { findUnique: vi.fn(async () => ({ id: 'T1' })) },
  },
}))

import { handleZombieChimmyAction } from '@/lib/zombie/chimmyActionHandler'

beforeEach(() => vi.clearAllMocks())

describe('Chimmy zombie actions that have no effect this season', () => {
  it('routes weapon and ambush commands through their engines without direct item writes', async () => {
    const weapon = await handleZombieChimmyAction('L1', 'u1', '@Chimmy use knife', 3)
    const ambush = await handleZombieChimmyAction('L1', 'u1', '@Chimmy ambush Brain Drain', 3)
    expect(weapon.ok).toBe(true)
    expect(ambush.ok).toBe(true)
    expect(h.weapon).toHaveBeenCalledTimes(1)
    expect(h.ambush).toHaveBeenCalledTimes(1)
    expect(h.itemUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['@Chimmy 💣 detonate bomb'],
    ['@Chimmy activate dark whisper power'],
  ])('%s is refused without spending until its effect is implemented', async (cmd) => {
    const r = await handleZombieChimmyAction('L1', 'u1', cmd, 3)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not_active_this_season')
    expect(r.privateMessage).toContain('nothing was spent')
    expect(h.itemUpdate).not.toHaveBeenCalled()
  })

  it('a serum shield still goes through the real serum engine', async () => {
    const r = await handleZombieChimmyAction('L1', 'u1', '@Chimmy use serum protect myself', 3)
    expect(h.serum).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
  })

  it('a revive still goes through the real serum engine', async () => {
    const r = await handleZombieChimmyAction('L1', 'u1', '@Chimmy revive', 3)
    expect(h.revive).toHaveBeenCalledWith('L1', 'u1', 3)
    expect(r.ok).toBe(true)
  })
})

describe('POST /api/zombie/items', () => {
  it.each([
    ['weapon_knife', 'tracked this season'],
    ['serum', '@Chimmy'],
  ])('refuses to spend a %s', async (itemType, hint) => {
    h.itemFindFirst.mockResolvedValue({ id: 'i1', itemType })
    const { POST } = await import('@/app/api/zombie/items/route')
    const res = await POST(
      new Request('http://localhost/api/zombie/items', {
        method: 'POST',
        body: JSON.stringify({ leagueId: 'L1', week: 3, itemType }),
      }),
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('not_active_this_season')
    expect(body.error).toContain(hint)
    expect(h.itemUpdate).not.toHaveBeenCalled()
  })
})
