// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildProjectionSchedule } from '@/lib/af-projections/leagueProjectionSchedule'
import { rankLeaguePlayerRates, totalsForLeaguePlayer } from '@/lib/af-projections/leaguePlayerMetrics'

describe('AF league projection schedule', () => {
  it.each(SUPPORTED_SPORTS)('uses the stored %s scoring period without counting duplicate feeds', (sport) => {
    const season = 2026
    const week = 1
    const start = resolveDailySportWeekWindow(sport, season, week)?.start ?? new Date('2026-09-06')
    const startTime = new Date(start.getTime() + 18 * 60 * 60 * 1000)
    const fixture = {
      startTime, week, homeTeam: 'Team One', awayTeam: 'Team Two',
      status: 'scheduled', seasonType: 'regular', source: 'first-feed',
    }
    const result = buildProjectionSchedule({
      sport, season, week, now: start,
      fixtures: [
        fixture,
        { ...fixture, source: 'second-feed' },
        { ...fixture, startTime: new Date(startTime.getTime() + 3 * 60 * 60 * 1000), status: 'cancelled' },
      ],
      teamKey: (name) => name,
    })
    const schedule = result.get('Team One')
    expect(schedule?.weekGames).toBe(1)
    expect(totalsForLeaguePlayer(12.2, schedule).weekly).toBe(12.2)
    if (sport === 'NBA' || sport === 'NFL') expect(schedule?.seasonGames).toBeNull()
  })

  it('covers doubleheaders, zero confirmed games and an unavailable period as distinct cases', () => {
    const schedule = { weekGames: 2, seasonGames: 162, remainingGames: 25 }
    expect(totalsForLeaguePlayer(4.5, schedule)).toEqual({
      weekly: 9, weekGames: 2, fullSeason: 729, restOfSeason: 112.5,
    })
    expect(totalsForLeaguePlayer(4.5, { ...schedule, weekGames: 0 }).weekly).toBe(0)
    expect(totalsForLeaguePlayer(4.5).weekly).toBeNull()
  })
})

describe('AF league player ranks', () => {
  it('ranks the league-scored rates and reports distinct position ranks', () => {
    const ranks = rankLeaguePlayerRates([
      { playerId: '1', playerName: 'Player C', position: 'C', perGame: 35 },
      { playerId: '2', playerName: 'Player B', position: 'G', perGame: 31 },
      { playerId: '3', playerName: 'Player A', position: 'C', perGame: 31 },
    ])
    expect(ranks.map(({ playerId, rank, positionRank }) => [playerId, rank, positionRank]))
      .toEqual([['1', 1, 1], ['3', 2, 2], ['2', 3, 1]])
  })
})
