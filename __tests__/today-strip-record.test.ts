// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => ({ seasonYear: 2026, week: 3 })) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  sportsGame: { findMany: vi.fn(async () => []) },
  leagueTeam: { findMany: vi.fn(async () => [1, 2, 3].map((id) => ({ externalId: String(id), league: { platformLeagueId: 'P' } }))) },
  weeklyMatchup: { findMany: vi.fn(async () => [
    { leagueId: 'P', rosterId: '1', pointsFor: 0, pointsAgainst: 0, win: 0 },
    { leagueId: 'P', rosterId: '2', pointsFor: 20, pointsAgainst: 10, win: 0 },
    { leagueId: 'P', rosterId: '3', pointsFor: 10, pointsAgainst: 20, win: 1 },
  ]) },
} }))
import { getTodayStrip } from '@/lib/core-app/todayStrip'
it('reports current leads and deficits, ignoring an unplayed pairing and stale win flags', async () => {
  const result = await getTodayStrip('U', [{ id: 'L', name: 'League', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'P', lastSyncedAt: null }], new Date('2026-09-26T16:00:00Z'))
  expect(result.record).toEqual({ available: true, data: { wins: 1, losses: 1, leaguesCounted: 2, season: 2026, week: 3 } })
})
