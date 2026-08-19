import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Regression guard for the League Buzz internal-resolution fix. `/api/shared/activity` is polled
 * every ~90s; it used to call getDashboardLeagueListForUser, whose 543-legacy-league fan-out +
 * redraftSeason/leagueSeason groupBy was a primary contributor to the production 53200 OOM. The lean
 * getActivityLeaguesForUser must resolve ONLY the two models the activity sources can use, and must
 * NOT touch the heavy ones. If someone re-points it at the full resolver, these fail.
 */

const leagueFindMany = vi.fn()
const sleeperFindMany = vi.fn()
const legacyLeagueFindMany = vi.fn()
const legacyTournamentFindMany = vi.fn()
const redraftSeasonGroupBy = vi.fn()
const leagueSeasonGroupBy = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    sleeperLeague: { findMany: (...a: unknown[]) => sleeperFindMany(...a) },
    // Present so an accidental call is observable rather than a mock-missing crash.
    legacyLeague: { findMany: (...a: unknown[]) => legacyLeagueFindMany(...a) },
    legacyTournament: { findMany: (...a: unknown[]) => legacyTournamentFindMany(...a) },
    redraftSeason: { groupBy: (...a: unknown[]) => redraftSeasonGroupBy(...a) },
    leagueSeason: { groupBy: (...a: unknown[]) => leagueSeasonGroupBy(...a) },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    appUser: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))

import { getActivityLeaguesForUser } from '@/lib/dashboard/get-dashboard-league-list'

const nativeRow = {
  id: 'nat-1',
  name: "TheCiege's 12-Team NFL Redraft League",
  sport: 'NFL',
  platform: 'manual',
  platformLeagueId: 'plat-1',
  leagueVariant: null,
  leagueSize: 12,
  status: 'setup',
  season: 2026,
  settings: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindMany.mockResolvedValue([nativeRow])
  sleeperFindMany.mockResolvedValue([])
})

describe('getActivityLeaguesForUser', () => {
  it('NEVER queries the heavy legacy / season-groupBy models (the OOM contributors)', async () => {
    await getActivityLeaguesForUser('user-1')
    expect(legacyLeagueFindMany).not.toHaveBeenCalled()
    expect(legacyTournamentFindMany).not.toHaveBeenCalled()
    expect(redraftSeasonGroupBy).not.toHaveBeenCalled()
    expect(leagueSeasonGroupBy).not.toHaveBeenCalled()
  })

  it('resolves only native leagues + real Sleeper leagues', async () => {
    await getActivityLeaguesForUser('user-1')
    expect(leagueFindMany).toHaveBeenCalledTimes(1)
    expect(sleeperFindMany).toHaveBeenCalledTimes(1)
    // Sleeper query is scoped to the user with a real team count — not a blanket scan.
    expect(sleeperFindMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'user-1', totalTeams: { gt: 0 } },
    })
  })

  it('maps native rows to the minimal ActivityLeagueEntry shape', async () => {
    const out = await getActivityLeaguesForUser('user-1')
    expect(out).toContainEqual({
      id: 'nat-1',
      name: "TheCiege's 12-Team NFL Redraft League",
      platform: 'manual',
      platformLeagueId: 'plat-1',
      season: 2026,
      status: 'setup',
      sport: 'NFL',
    })
  })

  it('maps Sleeper rows to platform:sleeper with platformLeagueId from sleeperLeagueId', async () => {
    sleeperFindMany.mockResolvedValueOnce([
      { id: 'slp-1', name: 'Dynasty Warriors', sleeperLeagueId: '111222333', totalTeams: 12, season: 2026, status: 'in_season' },
    ])
    const out = await getActivityLeaguesForUser('user-1')
    expect(out).toContainEqual({
      id: 'slp-1',
      name: 'Dynasty Warriors',
      platform: 'sleeper',
      platformLeagueId: '111222333',
      season: 2026,
      status: 'in_season',
      sport: 'NFL',
    })
  })

  it('applies isRealLeague — drops name-less / zero-team artifact rows', async () => {
    leagueFindMany.mockResolvedValueOnce([
      nativeRow,
      { ...nativeRow, id: 'artifact', name: '   ', leagueSize: 0 },
    ])
    const out = await getActivityLeaguesForUser('user-1')
    expect(out.map((l) => l.id)).toEqual(['nat-1'])
  })

  it('is resilient: one source query rejecting yields the other source, not a throw', async () => {
    leagueFindMany.mockRejectedValueOnce(new Error('53200 out of memory'))
    sleeperFindMany.mockResolvedValueOnce([
      { id: 'slp-9', name: 'Survivors', sleeperLeagueId: '999', totalTeams: 10, season: 2026, status: 'complete' },
    ])
    const out = await getActivityLeaguesForUser('user-1')
    expect(out.map((l) => l.id)).toEqual(['slp-9'])
  })
})
