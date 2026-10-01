import { describe, expect, it } from 'vitest'
import { normalizeMatchupState } from '@/lib/shared-services/game-day/MatchupStateNormalizer'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

function makeMatchup(overrides: Partial<MatchupCenterPayload> = {}): MatchupCenterPayload {
  return {
    leagueId: 'league-1',
    season: 2026,
    week: 5,
    sport: 'NFL',
    matchupStatus: 'upcoming',
    conceptOverlay: null,
    left: { rosterId: 'roster-1', teamName: 'My Team', avatarUrl: null, record: { wins: 3, losses: 2, ties: 0 }, winPct: 0.6, totalPoints: 0, projectedTotal: 100, starters: [], remainingStarters: 0 },
    right: { rosterId: 'roster-2', teamName: 'Opponent', avatarUrl: null, record: { wins: 2, losses: 3, ties: 0 }, winPct: 0.4, totalPoints: 0, projectedTotal: 90, starters: [], remainingStarters: 0 },
    winProbabilityLeft: 0.55,
    insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
    partialData: false,
    refreshIntervalMs: 30000,
    ...overrides,
  }
}

describe('normalizeMatchupState', () => {
  it('reports unavailable honestly when buildMatchupCenterPayload returned an error', () => {
    const result = normalizeMatchupState({ matchup: null, fetchedAt: new Date().toISOString(), unavailableReason: 'League not found' })
    expect(result.state).toBe('unavailable')
    expect(result.attribution.confidence).toBe(0)
    expect(result.attribution.missingDataReason).toBe('League not found')
  })

  it('detects bye via the real right.rosterId==="bye" sentinel', () => {
    const result = normalizeMatchupState({
      matchup: makeMatchup({ right: { rosterId: 'bye', teamName: 'No opponent', avatarUrl: null, record: { wins: 0, losses: 0, ties: 0 }, winPct: 0, totalPoints: 0, projectedTotal: 0, starters: [], remainingStarters: 0 } }),
      fetchedAt: new Date().toISOString(),
      unavailableReason: null,
    })
    expect(result.state).toBe('bye')
  })

  it('passes through upcoming/live/final directly', () => {
    for (const status of ['upcoming', 'live', 'final'] as const) {
      const result = normalizeMatchupState({ matchup: makeMatchup({ matchupStatus: status }), fetchedAt: new Date().toISOString(), unavailableReason: null })
      expect(result.state).toBe(status)
    }
  })

  it('reports unsupported for an unrecognized status rather than guessing', () => {
    const result = normalizeMatchupState({
      matchup: makeMatchup({ matchupStatus: 'something_new' as unknown as MatchupCenterPayload['matchupStatus'] }),
      fetchedAt: new Date().toISOString(),
      unavailableReason: null,
    })
    expect(result.state).toBe('unsupported')
  })

  it('overrides state to stale when the fetch is old, regardless of the reported status', () => {
    const oldFetchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const result = normalizeMatchupState({ matchup: makeMatchup({ matchupStatus: 'live' }), fetchedAt: oldFetchedAt, unavailableReason: null })
    expect(result.state).toBe('stale')
    expect(result.attribution.freshness).toBe('stale')
  })

  // Phase 34, Track A: real finding -- matchupCenterService.ts's buildEmptyMatchupPayload()
  // (used for the `kind: 'none'` real-no-matchup-data state, e.g. no TeamWeekResult row
  // exists) returns a well-formed payload with matchupStatus: 'upcoming' and
  // left.rosterId: 'none-left' -- previously this normalizer had no detection for that
  // shape, so it fell through to reporting a confident 'upcoming' state instead of
  // 'unavailable', even though the underlying data genuinely doesn't exist.
  it('detects the real "no matchup data" empty-payload shape (left.rosterId==="none-left") as unavailable, not upcoming', () => {
    const result = normalizeMatchupState({
      matchup: makeMatchup({
        conceptOverlay: 'No matchup this week (no_team_week_result_for_week_5)',
        left: { rosterId: 'none-left', teamName: 'Your team', avatarUrl: null, record: { wins: 0, losses: 0, ties: 0 }, winPct: 0, totalPoints: 0, projectedTotal: 0, starters: [], remainingStarters: 0 },
        right: { rosterId: 'none-right', teamName: 'No matchup', avatarUrl: null, record: { wins: 0, losses: 0, ties: 0 }, winPct: 0, totalPoints: 0, projectedTotal: 0, starters: [], remainingStarters: 0 },
        partialData: true,
      }),
      fetchedAt: new Date().toISOString(),
      unavailableReason: null,
    })
    expect(result.state).toBe('unavailable')
    expect(result.attribution.missingDataReason).toContain('no_team_week_result_for_week_5')
  })

  it('reduces confidence and records a reason for partialData without treating it as staleness', () => {
    const result = normalizeMatchupState({ matchup: makeMatchup({ partialData: true }), fetchedAt: new Date().toISOString(), unavailableReason: null })
    expect(result.state).toBe('upcoming')
    expect(result.attribution.freshness).toBe('fresh')
    expect(result.attribution.confidence).toBe(40)
    expect(result.attribution.missingDataReason).toContain('partialData')
  })
})
