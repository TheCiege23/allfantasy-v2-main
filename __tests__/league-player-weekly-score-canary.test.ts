import { describe, expect, it } from 'vitest'
import {
  buildLeagueScoreCanarySummary,
  evaluateLeagueScoreParityGate,
  resolveCanaryShadowWrite,
} from '@/lib/scoring/league-player-weekly-score-canary'

function summaryFixture(overrides: Partial<Parameters<typeof buildLeagueScoreCanarySummary>[0]> = {}) {
  return buildLeagueScoreCanarySummary({
    leagueId: 'L1',
    season: 2026,
    week: 4,
    rollup: {
      leagueId: 'L1',
      season: 2026,
      week: 4,
      write: false,
      allowGlobalOverwrite: false,
      allowCustomScoringWrite: false,
      writeApplied: false,
      candidateRows: [],
      missingPlayers: [],
      changedScores: 0,
      unchangedScores: 0,
      wouldCreate: 0,
      wouldUpdate: 0,
      wouldSkip: 0,
      writtenCreate: 0,
      writtenUpdate: 0,
      notes: [],
    },
    shadow: {
      writeRequested: false,
      writeApplied: false,
      candidateCount: 12,
      uniqueKeyCount: 12,
      duplicateInputCount: 0,
      scoringRulesHashMissingCount: 0,
      wouldUpsert: 12,
      writtenCreate: 0,
      writtenUpdate: 0,
      skipped: 0,
      wroteRows: 0,
      durationMs: 10,
      notes: ['dry_run_only'],
    },
    drift: {
      leagueId: 'L1',
      season: 2026,
      week: 4,
      matchupId: 'M1',
      checkedPlayers: 10,
      checkedTeams: 2,
      mismatchedPlayers: [],
      mismatchedTeams: [],
      missingWeeklyScores: 0,
      missingGameStats: 0,
      severity: 'none',
      notes: [],
    },
    ...overrides,
  })
}

describe('league-player-weekly-score-canary parity gate', () => {
  it('returns expected canary summary shape', () => {
    const summary = summaryFixture()
    expect(summary).toEqual(
      expect.objectContaining({
        leagueId: 'L1',
        season: 2026,
        week: 4,
        generatedAtIso: expect.any(String),
        rollup: expect.objectContaining({
          candidateRows: expect.any(Number),
          missingPlayers: expect.any(Number),
        }),
        shadow: expect.objectContaining({
          candidateCount: expect.any(Number),
          writeRequested: expect.any(Boolean),
        }),
        drift: expect.objectContaining({
          severity: expect.any(String),
          checkedPlayers: expect.any(Number),
        }),
      }),
    )
  })

  it('fails parity gate when drift exceeds threshold', () => {
    const summary = summaryFixture({
      drift: {
        leagueId: 'L1',
        season: 2026,
        week: 4,
        matchupId: 'M1',
        checkedPlayers: 10,
        checkedTeams: 2,
        mismatchedPlayers: [],
        mismatchedTeams: [
          {
            side: 'home',
            rosterId: 'R1',
            redraftMatchupScore: 100,
            sumPwsStarters: 100,
            sumPgsStarters: 99.95,
            deltaRedraftVsPgs: 0.05,
            deltaTeamPerfVsPgs: 0.05,
            teamPerformancePoints: 100,
            teamPerformanceTeamId: 'T1',
          },
        ],
        missingWeeklyScores: 0,
        missingGameStats: 0,
        severity: 'warning',
        notes: [],
      },
    })
    const result = evaluateLeagueScoreParityGate({ summary })
    expect(result.pass).toBe(false)
    expect(result.failures.map((f) => f.code)).toContain('team_drift_above_threshold')
  })

  it('passes parity gate for clean dry-run canary', () => {
    const summary = summaryFixture()
    const result = evaluateLeagueScoreParityGate({
      summary,
      scoringRulesHashMissingDocumented: true,
    })
    expect(result.pass).toBe(true)
    expect(result.failures).toHaveLength(0)
  })
})

describe('league-player-weekly-score-canary write guard', () => {
  it('never allows writes without confirmStaging', () => {
    expect(
      resolveCanaryShadowWrite({
        shadowWrite: true,
        confirmStaging: false,
        stagingConfirmed: true,
      }),
    ).toEqual({
      writeRequested: true,
      writeAllowed: false,
      blockedReason: 'confirm_staging_required',
    })
  })

  it('refuses writes when staging environment is not confirmed', () => {
    expect(
      resolveCanaryShadowWrite({
        shadowWrite: true,
        confirmStaging: true,
        stagingConfirmed: false,
      }),
    ).toEqual({
      writeRequested: true,
      writeAllowed: false,
      blockedReason: 'staging_environment_not_confirmed',
    })
  })
})
