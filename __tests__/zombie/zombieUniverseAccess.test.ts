// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  zombieUniverseFindUnique: vi.fn(),
  leagueFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieUniverse: { findUnique: hm.zombieUniverseFindUnique },
    league: { findFirst: hm.leagueFindFirst },
    roster: { findFirst: hm.rosterFindFirst },
  },
}))

import { resolveZombieUniverseAccess } from '@/lib/zombie/zombieUniverseAccess'

function universe(overrides: Record<string, unknown> = {}) {
  return {
    commissionedByUserId: 'user-owner',
    createdByUserId: 'user-creator',
    leagues: [{ leagueId: 'league-a' }, { leagueId: 'league-b' }],
    ...overrides,
  }
}

describe('resolveZombieUniverseAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.zombieUniverseFindUnique.mockResolvedValue(universe())
    hm.leagueFindFirst.mockResolvedValue(null)
    hm.rosterFindFirst.mockResolvedValue(null)
  })

  it('reports a missing universe', async () => {
    hm.zombieUniverseFindUnique.mockResolvedValueOnce(null)
    expect(await resolveZombieUniverseAccess('uni-1', 'user-x')).toEqual({ exists: false, isOwner: false, isMember: false })
  })

  it('treats the commissioner as owner and member', async () => {
    expect(await resolveZombieUniverseAccess('uni-1', 'user-owner')).toEqual({ exists: true, isOwner: true, isMember: true })
  })

  it('falls back to the creator when no commissioner is set', async () => {
    hm.zombieUniverseFindUnique.mockResolvedValueOnce(universe({ commissionedByUserId: null }))
    expect((await resolveZombieUniverseAccess('uni-1', 'user-creator')).isOwner).toBe(true)
  })

  it('does not treat the creator as owner when a commissioner is set', async () => {
    expect((await resolveZombieUniverseAccess('uni-1', 'user-creator')).isOwner).toBe(false)
  })

  it('treats a manager with a roster in a universe league as a member', async () => {
    hm.rosterFindFirst.mockResolvedValueOnce({ id: 'roster-1' })
    expect(await resolveZombieUniverseAccess('uni-1', 'user-manager')).toEqual({ exists: true, isOwner: false, isMember: true })
    expect(hm.rosterFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: { in: ['league-a', 'league-b'] }, platformUserId: 'user-manager' } }),
    )
  })

  it('treats the commissioner of a universe league as a member', async () => {
    hm.leagueFindFirst.mockResolvedValueOnce({ id: 'league-a' })
    expect((await resolveZombieUniverseAccess('uni-1', 'user-league-comm')).isMember).toBe(true)
  })

  it('refuses anyone else', async () => {
    expect(await resolveZombieUniverseAccess('uni-1', 'user-outsider')).toEqual({ exists: true, isOwner: false, isMember: false })
  })

  it('refuses a non-owner when the universe has no leagues', async () => {
    hm.zombieUniverseFindUnique.mockResolvedValueOnce(universe({ leagues: [] }))
    expect((await resolveZombieUniverseAccess('uni-1', 'user-manager')).isMember).toBe(false)
    expect(hm.rosterFindFirst).not.toHaveBeenCalled()
  })
})
