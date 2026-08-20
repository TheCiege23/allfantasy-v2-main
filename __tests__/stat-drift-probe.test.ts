import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({
  leagueUsesC2CEngine: vi.fn<[], Promise<boolean>>(),
  leagueUsesDevyEngine: vi.fn<[], Promise<boolean>>(),
  leagueFindUnique: vi.fn(),
  redraftSeasonFindFirst: vi.fn(),
  redraftMatchupFindFirst: vi.fn(),
}))

vi.mock('@/lib/c2c/scoringEngine', () => ({
  leagueUsesC2CEngine: m.leagueUsesC2CEngine,
}))

vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: m.leagueUsesDevyEngine,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique },
    redraftSeason: { findFirst: m.redraftSeasonFindFirst },
    redraftMatchup: { findFirst: m.redraftMatchupFindFirst },
  },
}))

vi.mock('@/lib/multi-sport/MultiSportMatchupScoringService', () => ({
  computeRosterScoreForWeek: vi.fn(async () => ({
    totalPoints: 0,
    byPlayerId: {},
    usedPlayerIds: [],
  })),
}))

import {
  computeStatDriftSeverity,
  runStatDriftProbe,
  type StatDriftPlayerRow,
  type StatDriftTeamRow,
} from '@/lib/scoring/stat-drift-probe'

describe('computeStatDriftSeverity', () => {
  it('returns none when no issues', () => {
    expect(
      computeStatDriftSeverity({
        mismatchedPlayers: [],
        mismatchedTeams: [],
        missingWeeklyScores: 0,
        missingGameStats: 0,
      }),
    ).toBe('none')
  })

  it('returns info when only missing substrates', () => {
    expect(
      computeStatDriftSeverity({
        mismatchedPlayers: [],
        mismatchedTeams: [],
        missingWeeklyScores: 2,
        missingGameStats: 0,
      }),
    ).toBe('info')
  })

  it('returns warning when player delta exceeds match epsilon', () => {
    const rows: StatDriftPlayerRow[] = [
      {
        playerId: 'p1',
        side: 'home',
        sport: 'NFL',
        pgsPoints: 10,
        pwsPoints: 10.5,
        delta: 0.5,
        missingPgs: false,
        missingPws: false,
      },
    ]
    expect(
      computeStatDriftSeverity({
        mismatchedPlayers: rows,
        mismatchedTeams: [],
        missingWeeklyScores: 0,
        missingGameStats: 0,
      }),
    ).toBe('warning')
  })

  it('returns critical when player delta exceeds warn epsilon', () => {
    const rows: StatDriftPlayerRow[] = [
      {
        playerId: 'p1',
        side: 'home',
        sport: 'NFL',
        pgsPoints: 0,
        pwsPoints: 10,
        delta: 10,
        missingPgs: true,
        missingPws: false,
      },
    ]
    expect(
      computeStatDriftSeverity({
        mismatchedPlayers: rows,
        mismatchedTeams: [],
        missingWeeklyScores: 0,
        missingGameStats: 0,
      }),
    ).toBe('critical')
  })

  it('returns warning on team redraft vs pgs drift', () => {
    const teams: StatDriftTeamRow[] = [
      {
        side: 'home',
        rosterId: 'r1',
        redraftMatchupScore: 100,
        sumPwsStarters: 100,
        sumPgsStarters: 99.2,
        deltaRedraftVsPgs: 0.35,
        deltaTeamPerfVsPgs: 0,
        teamPerformancePoints: 99.2,
        teamPerformanceTeamId: 't1',
      },
    ]
    expect(
      computeStatDriftSeverity({
        mismatchedPlayers: [],
        mismatchedTeams: teams,
        missingWeeklyScores: 0,
        missingGameStats: 0,
      }),
    ).toBe('warning')
  })
})

describe('runStatDriftProbe', () => {
  const logs: string[] = []
  const origLog = console.log

  beforeEach(() => {
    logs.length = 0
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    m.leagueUsesC2CEngine.mockResolvedValue(false)
    m.leagueUsesDevyEngine.mockResolvedValue(false)
    m.leagueFindUnique.mockReset()
    m.redraftSeasonFindFirst.mockReset()
    m.redraftMatchupFindFirst.mockReset()
  })

  afterEach(() => {
    console.log = origLog
    vi.clearAllMocks()
  })

  it('returns league_not_found and emits structured logs', async () => {
    m.leagueFindUnique.mockResolvedValue(null)

    const res = await runStatDriftProbe({ leagueId: 'missing', season: 2025, week: 1, jobName: 'test' })
    expect(res.notes).toContain('league_not_found')
    expect(res.checkedPlayers).toBe(0)
    expect(logs.some((l) => l.includes('"event":"stat_drift_probe_started"'))).toBe(true)
    expect(logs.some((l) => l.includes('"event":"stat_drift_probe_failed"'))).toBe(true)
  })

  it('skips matchup compare when C2C engine', async () => {
    m.leagueUsesC2CEngine.mockResolvedValue(true)
    m.leagueFindUnique.mockResolvedValue({
      id: 'L1',
      sport: 'NFL',
      leagueVariant: null,
      settings: {},
    })

    const res = await runStatDriftProbe({ leagueId: 'L1', season: 2025, week: 3, jobName: 'test' })
    expect(res.notes.some((n) => n.includes('c2c'))).toBe(true)
    expect(m.redraftMatchupFindFirst).not.toHaveBeenCalled()
    expect(logs.some((l) => l.includes('"event":"stat_drift_probe_completed"'))).toBe(true)
  })
})
