import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('resolveActiveWeekFromInputs', () => {
  const base = {
    leagueId: 'league-1',
    leagueSport: 'NFL',
    leagueSeasonOfRecord: 2026,
    settings: null as unknown,
    redraftSeason: null as null | { status: string; currentWeek: number; season: number },
    nflDominantWeek: null as number | null,
  }

  it('explicit override wins', async () => {
    const { resolveActiveWeekFromInputs } = await import('@/lib/scoring/active-week-resolver')
    const r = resolveActiveWeekFromInputs({
      ...base,
      redraftSeason: { status: 'active', currentWeek: 3, season: 2026 },
      explicitWeekOrRound: 7,
      explicitSeason: 2025,
      nflDominantWeek: 2,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.week).toBe(7)
      expect(r.season).toBe(2025)
      expect(r.source).toBe('explicit')
    }
  })

  it('RedraftSeason.currentWeek wins when no explicit week', async () => {
    const { resolveActiveWeekFromInputs } = await import('@/lib/scoring/active-week-resolver')
    const r = resolveActiveWeekFromInputs({
      ...base,
      redraftSeason: { status: 'active', currentWeek: 11, season: 2026 },
      nflDominantWeek: 5,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.week).toBe(11)
      expect(r.season).toBe(2026)
      expect(r.source).toBe('redraft_season_current_week')
    }
  })

  it('league settings fallback after redraft misses', async () => {
    const { resolveActiveWeekFromInputs } = await import('@/lib/scoring/active-week-resolver')
    const r = resolveActiveWeekFromInputs({
      ...base,
      settings: { leg: 9 },
      redraftSeason: null,
      nflDominantWeek: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.week).toBe(9)
      expect(r.source).toBe('league_settings')
    }
  })

  it('missing week does not default silently to 1', async () => {
    const { resolveActiveWeekFromInputs } = await import('@/lib/scoring/active-week-resolver')
    const r = resolveActiveWeekFromInputs({
      ...base,
      leagueSport: 'NBA',
      settings: {},
      redraftSeason: null,
      nflDominantWeek: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('active_week_unresolved')
    }
  })

  it('NFL dominant fallback is last resort with warning', async () => {
    const { resolveActiveWeekFromInputs } = await import('@/lib/scoring/active-week-resolver')
    const r = resolveActiveWeekFromInputs({
      ...base,
      settings: {},
      redraftSeason: null,
      nflDominantWeek: 6,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.week).toBe(6)
      expect(r.source).toBe('nfl_dominant_active_redraft_week')
      expect(r.warning).toBe(true)
    }
  })
})

describe('parseWeekFromLeagueSettings', () => {
  it('reads leg and currentWeek', async () => {
    const { parseWeekFromLeagueSettings } = await import('@/lib/scoring/active-week-resolver')
    expect(parseWeekFromLeagueSettings({ leg: 14 })).toBe(14)
    expect(parseWeekFromLeagueSettings({ current_week: '8' })).toBe(8)
  })
})

describe('runScoringWorker explicit batch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('passes batch season and week into scoreLeagueWeek', async () => {
    const scoreSpy = vi.fn().mockResolvedValue({
      leagueId: 'L1',
      season: 2025,
      weekOrRound: 8,
      rosterCount: 2,
      updatedTeamCount: 2,
      locked: false,
    })
    vi.doMock('@/lib/scoring/scoring-engine', () => ({
      scoreLeagueWeek: scoreSpy,
    }))
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: {
          findMany: vi.fn().mockResolvedValue([{ id: 'L1', season: 2026 }]),
        },
      },
    }))
    vi.doMock('@/lib/scoring/active-week-resolver', () => ({
      resolveActiveWeekForLeague: vi.fn(),
      resolveDominantNflActiveRedraftWeek: vi.fn(),
      parseWeekFromLeagueSettings: vi.fn(),
      logActiveWeekResolved: vi.fn(),
      logActiveWeekUnresolved: vi.fn(),
    }))

    const { runScoringWorker } = await import('@/lib/workers/scoring-worker')
    await runScoringWorker({
      leagueIds: ['L1'],
      season: 2025,
      weekOrRound: 8,
      jobName: 'test:explicit_batch',
    })

    expect(scoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'L1',
        season: 2025,
        weekOrRound: 8,
      }),
    )
  })
})
