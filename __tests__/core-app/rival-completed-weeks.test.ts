// @vitest-environment node
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({
  readLeagueWeekMetadata: vi.fn(async () => [{ id: 'L', season: 2026, status: 'in_season', settings: { leg: 3 } }]),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findMany: vi.fn(async () => [{ id: 'L', platformLeagueId: 'P' }]) },
  leagueTeam: { findMany: vi.fn(async () => [
    { leagueId: 'L', externalId: '1', claimedByUserId: 'U', ownerName: 'Me' },
    { leagueId: 'L', externalId: '2', ownerName: 'Rival' },
  ]) },
  weeklyMatchup: { findMany: vi.fn(async () => [
    { leagueId: 'P', seasonYear: 2026, week: 2, rosterId: '1', matchupId: 1, pointsFor: 100 },
    { leagueId: 'P', seasonYear: 2026, week: 2, rosterId: '2', matchupId: 1, pointsFor: 90 },
    { leagueId: 'P', seasonYear: 2026, week: 3, rosterId: '1', matchupId: 1, pointsFor: 20 },
    { leagueId: 'P', seasonYear: 2026, week: 3, rosterId: '2', matchupId: 1, pointsFor: 40 },
  ]) },
} }))

import { getRivalRecords } from '@/lib/core-app/dash3aPanels'

it('does not turn this week’s partial loss into a completed rivalry meeting', async () => {
  const result = await getRivalRecords('U', ['L'])
  expect(result.available).toBe(true)
  if (!result.available) throw new Error(result.reason)
  expect(result.data.rows[0]).toMatchObject({ wins: 1, losses: 0, meetings: 1, lastResult: 'you won by 10.0' })
})
