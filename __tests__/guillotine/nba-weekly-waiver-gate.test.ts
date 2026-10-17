import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  league: { findUnique: vi.fn() },
  redraftWaiverClaim: { findMany: vi.fn(async () => []) },
  survivorGameState: { findUnique: vi.fn(async () => null) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { processWaiverWindow } = await import('@/lib/redraft/waiverEngine')
const { getLastWaiverTime } = await import('@/lib/guillotine/sportConfig')

// Friday 2026-10-30 15:00 UTC: the last NBA waiver run was Thursday 2026-10-29 12:00 UTC.
const NOW = new Date('2026-10-30T15:00:00.000Z')

describe('guillotine weekly waiver gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1' })
  })

  it('NBA last waiver run is Thursday 12:00 UTC', () => {
    expect(getLastWaiverTime('NBA', NOW)?.toISOString()).toBe('2026-10-29T12:00:00.000Z')
    // At the run hour itself, that run counts as the last one.
    expect(getLastWaiverTime('NBA', new Date('2026-10-29T12:20:00.000Z'))?.toISOString()).toBe('2026-10-29T12:00:00.000Z')
  })

  it('an NBA guillotine league settles only claims submitted before the last scheduled run', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ sport: 'NBA', guillotineMode: true, leagueVariant: null })
    await processWaiverWindow('league-1', 'season-1', NOW)
    expect(prismaMock.redraftWaiverClaim.findMany.mock.calls[0][0].where).toEqual({
      leagueId: 'league-1',
      seasonId: 'season-1',
      status: 'pending',
      submittedAt: { lt: new Date('2026-10-29T12:00:00.000Z') },
    })
  })

  it('leaves NFL guillotine and non-guillotine leagues ungated', async () => {
    for (const league of [
      { sport: 'NFL', guillotineMode: true, leagueVariant: 'guillotine' },
      { sport: 'NBA', guillotineMode: false, leagueVariant: 'redraft' },
    ]) {
      prismaMock.league.findUnique.mockResolvedValueOnce(league)
      prismaMock.redraftWaiverClaim.findMany.mockClear()
      await processWaiverWindow('league-1', 'season-1', NOW)
      expect(prismaMock.redraftWaiverClaim.findMany.mock.calls[0][0].where).not.toHaveProperty('submittedAt')
    }
  })
})
