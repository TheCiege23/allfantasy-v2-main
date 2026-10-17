import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  league: { findUnique: vi.fn() },
  redraftWaiverClaim: { findMany: vi.fn(async () => []) },
  survivorGameState: { findUnique: vi.fn(async () => null) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { processWaiverWindow } = await import('@/lib/redraft/waiverEngine')
const { getWaiverBlindWindowStart } = await import('@/lib/guillotine/sportConfig')

const whereOf = () => prismaMock.redraftWaiverClaim.findMany.mock.calls[0][0].where

describe('guillotine blind waiver window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1' })
  })

  it('NFL: the window opens 36h before the Wednesday 12:00 UTC run and covers the Tuesday chop', () => {
    // Run: Wed 2026-10-28 12:00 UTC → window opens Tue 2026-10-27 00:00 UTC (Mon 8pm ET).
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-10-27T23:00:00Z'))?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-10-28T11:59:00Z'))?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
    // Outside the window: Sunday morning, and the hour the run fires.
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-11-01T15:00:00Z'))).toBeNull()
    expect(getWaiverBlindWindowStart('NFL', new Date('2026-10-28T12:10:00Z'))).toBeNull()
  })

  it('NBA: the window runs Wednesday 00:00 UTC to the Thursday 12:00 UTC run', () => {
    expect(getWaiverBlindWindowStart('NBA', new Date('2026-10-28T03:00:00Z'))?.toISOString()).toBe('2026-10-28T00:00:00.000Z')
    expect(getWaiverBlindWindowStart('NBA', new Date('2026-10-27T23:00:00Z'))).toBeNull()
  })

  it('inside the window a guillotine league holds claims submitted after it opened', async () => {
    for (const sport of ['NFL', 'NBA']) {
      prismaMock.redraftWaiverClaim.findMany.mockClear()
      prismaMock.league.findUnique.mockResolvedValueOnce({ sport, guillotineMode: true, leagueVariant: null })
      const now = sport === 'NFL' ? new Date('2026-10-27T23:00:00Z') : new Date('2026-10-28T03:00:00Z')
      await processWaiverWindow('league-1', 'season-1', now)
      expect(whereOf()).toEqual({
        leagueId: 'league-1',
        seasonId: 'season-1',
        status: 'pending',
        submittedAt: { lt: getWaiverBlindWindowStart(sport, now) },
      })
    }
  })

  it('outside the window, and for other leagues, every pending claim settles', async () => {
    const sunday = new Date('2026-11-01T15:00:00Z')
    const insideNfl = new Date('2026-10-27T23:00:00Z')
    for (const [league, now] of [
      [{ sport: 'NFL', guillotineMode: true, leagueVariant: null }, sunday],
      [{ sport: 'NFL', guillotineMode: false, leagueVariant: 'redraft' }, insideNfl],
      [{ sport: 'MLB', guillotineMode: true, leagueVariant: 'guillotine' }, insideNfl],
    ] as const) {
      prismaMock.redraftWaiverClaim.findMany.mockClear()
      prismaMock.league.findUnique.mockResolvedValueOnce(league)
      await processWaiverWindow('league-1', 'season-1', now)
      expect(whereOf()).not.toHaveProperty('submittedAt')
    }
  })
})
