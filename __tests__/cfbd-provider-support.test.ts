import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cfbdProvider } from '@/lib/workers/providers/cfbd'

describe('cfbdProvider supports sport normalization', () => {
  const originalApiKey = process.env.CFBD_API_KEY
  const originalLegacyKey = process.env.CFBD_KEY

  beforeEach(() => {
    delete process.env.CFBD_API_KEY
    delete process.env.CFBD_KEY
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.CFBD_API_KEY
    else process.env.CFBD_API_KEY = originalApiKey
    if (originalLegacyKey === undefined) delete process.env.CFBD_KEY
    else process.env.CFBD_KEY = originalLegacyKey
  })

  it('accepts lowercase, uppercase, and alias NCAAF values', () => {
    expect(cfbdProvider.supports({ sport: 'ncaaf', dataType: 'schedule' })).toBe(true)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'schedule' })).toBe(true)
    expect(cfbdProvider.supports({ sport: 'CFB', dataType: 'teams' })).toBe(true)
  })

  it('does not claim non-NCAAF sports or unsupported data types', () => {
    expect(cfbdProvider.supports({ sport: 'NFL', dataType: 'schedule' })).toBe(false)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'injuries' })).toBe(false)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'projections' })).toBe(false)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'player_stats' })).toBe(true)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'team_stats' })).toBe(true)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'rankings' })).toBe(true)
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'standings' })).toBe(true)
  })

  it('uses CFBD_KEY as a supported production alias when CFBD_API_KEY is absent', async () => {
    process.env.CFBD_KEY = 'legacy-cfbd-key'
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, school: 'Example State', abbreviation: 'EXS', conference: 'Test' }],
    })

    const rows = await cfbdProvider.fetch({
      sport: 'NCAAF',
      dataType: 'teams',
      query: { season: '2026' },
    })

    expect(rows).toEqual([
      expect.objectContaining({ id: '1', name: 'Example State', source: 'cfbd' }),
    ])
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/teams/fbs?year=2026'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer legacy-cfbd-key' }),
      })
    )
  })

  it('maps CFBD games with week and scores so schedule rows can normalize', async () => {
    process.env.CFBD_API_KEY = 'cfbd-key'
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 99,
          week: 1,
          home_team: 'Example State',
          away_team: 'Coastal Test',
          start_date: '2026-09-05T16:00:00.000Z',
          completed: true,
          home_points: 28,
          away_points: 21,
          venue: 'Example Stadium',
        },
      ],
    })

    const rows = await cfbdProvider.fetch({
      sport: 'NCAAF',
      dataType: 'schedule',
      query: { season: '2026' },
    })

    expect(rows).toEqual([
      expect.objectContaining({
        id: '99',
        week: 1,
        homeTeam: 'Example State',
        awayTeam: 'Coastal Test',
        homeScore: 28,
        awayScore: 21,
        status: 'final',
      }),
    ])
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/games?year=2026'),
      expect.any(Object),
    )
  })

  it('fetches CFBD roster and season-stat endpoints without claiming fantasy projections', async () => {
    process.env.CFBD_API_KEY = 'cfbd-key'
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'p1', name: 'College Runner', position: 'RB', jersey: 22 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ playerId: 'p1', player: 'College Runner', team: 'Example State', category: 'rushing', statType: 'yards', stat: 1000 }],
      })

    const roster = await cfbdProvider.fetch({
      sport: 'NCAAF',
      dataType: 'roster',
      query: { season: '2026', team: 'Example State' },
    })
    const stats = await cfbdProvider.fetch({
      sport: 'NCAAF',
      dataType: 'player_stats',
      query: { season: '2026', category: 'rushing' },
    })

    expect(roster).toEqual([expect.objectContaining({ id: 'p1', name: 'College Runner', team: 'Example State' })])
    expect(stats).toEqual([expect.objectContaining({ playerId: 'p1', player: 'College Runner', category: 'rushing', statType: 'yards' })])
    expect(cfbdProvider.supports({ sport: 'NCAAF', dataType: 'fantasy_projections' })).toBe(false)
  })
})
