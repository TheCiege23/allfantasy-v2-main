import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, draftFindMany } = vi.hoisted(() => ({ findMany: vi.fn(), draftFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany },
    draftSession: { findMany: draftFindMany },
  },
}))

import { getCoreActivitySnapshot } from '@/lib/core-app/coreActivity'
import { coreRefreshIntervalMs } from '@/lib/core-app/coreRefreshPolicy'

const NOW = new Date('2026-09-13T17:15:00.000Z')

beforeEach(() => {
  findMany.mockReset()
  draftFindMany.mockReset()
  draftFindMany.mockResolvedValue([])
})

describe('Core game-day activity', () => {
  it('uses the fast shell cadence for an active slate or a positively live game', () => {
    expect(coreRefreshIntervalMs(true, 0)).toBe(20_000)
    expect(coreRefreshIntervalMs(false, 2)).toBe(20_000)
    expect(coreRefreshIntervalMs(false, 0)).toBe(120_000)
  })

  it('uses one live game across duplicate feed rows', async () => {
    findMany.mockResolvedValue([
      {
        sport: 'NFL', externalId: '401772700', status: 'in_progress',
        startTime: new Date('2026-09-13T17:00:00.000Z'), fetchedAt: new Date('2026-09-13T17:14:58.000Z'),
      },
      {
        sport: 'NFL', externalId: '401772700', status: 'scheduled',
        startTime: new Date('2026-09-13T17:00:00.000Z'), fetchedAt: new Date('2026-09-13T17:14:00.000Z'),
      },
    ])

    await expect(getCoreActivitySnapshot(['league-1'], ['NFL'], NOW)).resolves.toEqual({
      gameDayActive: true,
      liveGameCount: 1,
      draftLive: false,
      liveDraftLeagueIds: [],
    })
  })

  it('opens the fast refresh lane at kickoff while a provider still says scheduled', async () => {
    findMany.mockResolvedValue([
      {
        sport: 'NFL', externalId: 'game-2', status: 'scheduled',
        startTime: new Date('2026-09-13T17:00:00.000Z'), fetchedAt: NOW,
      },
    ])

    const result = await getCoreActivitySnapshot(['league-1'], ['NFL'], NOW)
    expect(result.gameDayActive).toBe(true)
    expect(result.liveGameCount).toBe(0)
  })

  it('keeps completed games out of the game-day lane and exposes live drafts', async () => {
    findMany.mockResolvedValue([
      {
        sport: 'NFL', externalId: 'game-3', status: 'final',
        startTime: new Date('2026-09-13T17:00:00.000Z'), fetchedAt: NOW,
      },
    ])
    draftFindMany.mockResolvedValue([{ leagueId: 'league-1' }])

    await expect(getCoreActivitySnapshot(['league-1'], ['NFL'], NOW)).resolves.toEqual({
      gameDayActive: false,
      liveGameCount: 0,
      draftLive: true,
      liveDraftLeagueIds: ['league-1'],
    })
  })

  /* The Draft HQ badge counts leagues, so two sessions in one league are one league. */
  it('names each league with a live draft once, asking only for your leagues and live statuses', async () => {
    findMany.mockResolvedValue([])
    draftFindMany.mockResolvedValue([{ leagueId: 'a' }, { leagueId: 'b' }, { leagueId: 'a' }])

    const result = await getCoreActivitySnapshot(['a', 'b', 'a'], ['NFL'], NOW)
    expect(result.liveDraftLeagueIds).toEqual(['a', 'b'])
    const where = draftFindMany.mock.calls[0]![0].where
    expect(where.leagueId).toEqual({ in: ['a', 'b'] })
    expect(where.status).toEqual({ in: ['in_progress', 'paused', 'active', 'live'] })
  })
})
