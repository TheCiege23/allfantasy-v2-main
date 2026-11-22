import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => {
  const { inMemoryPrisma } = await import('../helpers/inMemoryPrisma')
  return { prisma: inMemoryPrisma.client, default: inMemoryPrisma.client }
})
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: async () => undefined }),
  EVENT: new Proxy({}, { get: (_t, key) => String(key) }),
}))

import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { redraftPlayoffShapeFor } from '@/lib/league-defaults/redraftPlayoffFit'
import { describeFullSeason } from '../helpers/redraftFullSeasonInvariants'

describe('soccer season gameweek calendar', () => {
  it('skips the September international break and reaches week 38', () => {
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 6)?.start.toISOString()).toBe('2026-09-18T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 7)?.start.toISOString()).toBe('2026-10-09T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 38)?.start.toISOString()).toBe('2027-05-28T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 39)).toBeNull()
  })
  it('fits four-team and six-team brackets into all 38 gameweeks', () => {
    for (const leagueSize of [4, 10]) {
      const shape = redraftPlayoffShapeFor({ sport: 'SOCCER', leagueSize, leagueType: 'redraft' })
      expect(shape).toMatchObject({ playoffStartWeek: 35, regularSeasonEndWeek: 34,
        championshipWeek: 38, seasonWeeks: 38, playoffWeeks: 4 })
    }
  })
})

describeFullSeason('SOCCER redraft full season — 4 teams', { sport: 'SOCCER', teamCount: 4 })
describeFullSeason('SOCCER redraft full season — 10 teams', { sport: 'SOCCER', teamCount: 10 })
