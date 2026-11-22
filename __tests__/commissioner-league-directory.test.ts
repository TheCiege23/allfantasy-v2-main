// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leagues: vi.fn(), groupBy: vi.fn(), role: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findMany: mocks.leagues }, leagueTeam: { groupBy: mocks.groupBy } },
}))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: mocks.role,
  isCommissionerRole: (role: unknown) => role === 'commissioner' || role === 'co_commissioner',
}))

import { listManagedLeagues, readManagerSeats } from '@/lib/core-app/commissioner/leagueDirectory'

describe('commissioner league directory', () => {
  it('lists owned and delegated leagues and applies the individual hub role check to delegated candidates', async () => {
    mocks.leagues.mockResolvedValue([
      { id: 'owned', userId: 'owner', platform: 'fantrax' },
      { id: 'delegated', userId: 'other', platform: 'allfantasy' },
      { id: 'viewer', userId: 'other', platform: 'fantrax' },
    ])
    mocks.role.mockImplementation(async (id) => id === 'delegated' ? 'co_commissioner' : 'viewer')

    expect(await listManagedLeagues('owner', ['owned', 'delegated', 'viewer'])).toEqual([
      { id: 'owned', native: false },
      { id: 'delegated', native: true },
    ])
    expect(mocks.role.mock.calls).toEqual([['delegated', 'owner'], ['viewer', 'owner']])
    expect(mocks.leagues.mock.calls[0]?.[0].where.id).toEqual({ in: ['owned', 'delegated', 'viewer'] })
    expect(mocks.leagues.mock.calls[0]?.[0].where.OR).toEqual(expect.arrayContaining([
      { userId: 'owner' },
      { settings: { path: ['importCoCommissionerIds'], array_contains: ['owner'] } },
    ]))
  })

  it('loads seats for only the authorized IDs using one grouped count across the portfolio', async () => {
    mocks.groupBy.mockResolvedValue([
      { leagueId: 'one', _count: { _all: 180, claimedByUserId: 150 } },
      { leagueId: 'two', _count: { _all: 330, claimedByUserId: 310 } },
    ])
    expect([...(await readManagerSeats(['one', 'two']))]).toEqual([
      ['one', { total: 180, claimed: 150 }],
      ['two', { total: 330, claimed: 310 }],
    ])
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: { in: ['one', 'two'] } } }))
  })
})
