// @vitest-environment node
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  sportsGame: { findMany: vi.fn(async () => [
    { sport: 'NCAAF', startTime: new Date('2026-09-26T16:30:00Z'), week: 4, awayTeam: 'Holy Cross', homeTeam: 'Lafayette' },
    { sport: 'NCAAF', startTime: new Date('2026-09-26T16:30:00Z'), week: 4, awayTeam: 'HOLY CROSS', homeTeam: 'LAFAYETTE' },
    { sport: 'NCAAF', startTime: new Date('2026-09-26T20:30:00Z'), week: 4, awayTeam: 'Holy Cross', homeTeam: 'Lafayette' },
  ]) },
} }))
import { getTodayStrip } from '@/lib/core-app/todayStrip'

it('shows a fixture once across source copies while keeping a later game between the same teams', async () => {
  const result = await getTodayStrip('U', [{ id: 'L', name: 'College', platform: 'sleeper', sport: 'NCAAF', platformLeagueId: 'P', lastSyncedAt: null }], new Date('2026-09-26T16:00:00Z'))
  expect(result.next24).toHaveLength(2)
  expect(result.next24.map((row) => row.time)).toEqual(['2026-09-26T16:30:00.000Z', '2026-09-26T20:30:00.000Z'])
})
