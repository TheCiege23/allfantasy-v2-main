import { describe, expect, it } from 'vitest'
import { buildLearningSnapshotFromEvents } from '@/lib/chimmy-actions/AIActionAnalytics'

describe('buildLearningSnapshotFromEvents', () => {
  it('aggregates lifecycle metrics and style preferences', () => {
    const rows = [
      {
        id: '1',
        action_type: 'claim_player',
        surface: 'waiver_wire',
        user_id: 'user-1',
        league_id: 'league-1',
        team_id: 'team-1',
        sport: 'NFL',
        event: 'shown',
        timestamp: new Date().toISOString(),
        duration_ms: null,
        metadata: { recommendationStyle: 'upside' },
      },
      {
        id: '2',
        action_type: 'claim_player',
        surface: 'waiver_wire',
        user_id: 'user-1',
        league_id: 'league-1',
        team_id: 'team-1',
        sport: 'NFL',
        event: 'clicked',
        timestamp: new Date().toISOString(),
        duration_ms: 120,
        metadata: { recommendationStyle: 'upside' },
      },
      {
        id: '3',
        action_type: 'claim_player',
        surface: 'waiver_wire',
        user_id: 'user-1',
        league_id: 'league-1',
        team_id: 'team-1',
        sport: 'NFL',
        event: 'completed',
        timestamp: new Date().toISOString(),
        duration_ms: 220,
        metadata: {
          recommendationStyle: 'upside',
          followedSuggestion: true,
          measurableOutcome: true,
          outcomeType: 'waiver_result',
        },
      },
      {
        id: '4',
        action_type: 'save_recommendation',
        surface: 'dashboard',
        user_id: 'user-1',
        league_id: 'league-1',
        team_id: 'team-1',
        sport: 'NFL',
        event: 'shown',
        timestamp: new Date().toISOString(),
        duration_ms: null,
        metadata: { recommendationStyle: 'safe' },
      },
      {
        id: '5',
        action_type: 'save_recommendation',
        surface: 'dashboard',
        user_id: 'user-1',
        league_id: 'league-1',
        team_id: 'team-1',
        sport: 'NFL',
        event: 'dismissed',
        timestamp: new Date().toISOString(),
        duration_ms: null,
        metadata: { recommendationStyle: 'safe' },
      },
    ] as any

    const snapshot = buildLearningSnapshotFromEvents(rows, { minActionEvents: 1 })

    expect(snapshot.totals.shown).toBe(2)
    expect(snapshot.totals.clicked).toBe(1)
    expect(snapshot.totals.completed).toBe(1)
    expect(snapshot.totals.dismissed).toBe(1)
    expect(snapshot.totals.followedSuggestion).toBe(1)
    expect(snapshot.totals.measurableOutcomes).toBe(2)

    const claim = snapshot.actionMetrics.find((m) => m.actionType === 'claim_player')
    expect(claim?.followRate).toBe(1)
    expect(claim?.completionRate).toBe(1)
    expect(claim?.avgDurationMs).toBe(170)

    const upsideStyle = snapshot.recommendationStylePreferences.find((s) => s.style === 'upside')
    expect(upsideStyle?.completionRate).toBe(1)

    const safeStyle = snapshot.recommendationStylePreferences.find((s) => s.style === 'safe')
    expect(safeStyle?.dismissalRate).toBe(1)

    const outcomeTypes = snapshot.measurableOutcomesByType.map((o) => o.outcomeType)
    expect(outcomeTypes).toContain('waiver_result')
    expect(outcomeTypes).toContain('waiver_followthrough')
  })

  it('supports custom measurable outcome adapters', () => {
    const rows = [
      {
        id: 'custom-1',
        action_type: 'save_lineup',
        surface: 'matchup',
        user_id: 'user-1',
        league_id: 'league-1',
        team_id: 'team-1',
        sport: 'NFL',
        event: 'completed',
        timestamp: new Date().toISOString(),
        duration_ms: 180,
        metadata: null,
      },
    ] as any

    const snapshot = buildLearningSnapshotFromEvents(rows, {
      minActionEvents: 1,
      outcomeAdapters: [
        {
          id: 'custom-lineup-outcome',
          match: (row) => row.action_type === 'save_lineup' && row.event === 'completed',
          derive: () => ({
            outcomeType: 'lineup_points_delta',
            value: 12,
            direction: 'positive',
            source: 'custom-test-adapter',
          }),
        },
      ],
    })

    expect(snapshot.totals.measurableOutcomes).toBe(1)
    expect(snapshot.measurableOutcomesByType[0]?.outcomeType).toBe('lineup_points_delta')
    expect(snapshot.measurableOutcomesByType[0]?.avgValue).toBe(12)
  })

  it('does not count a staged action as a completion or derive an outcome from it', () => {
    const base = {
      action_type: 'claim_player',
      surface: 'waiver_wire',
      user_id: 'user-1',
      league_id: 'league-1',
      team_id: 'team-1',
      sport: 'NFL',
      timestamp: new Date().toISOString(),
      duration_ms: null,
    }
    const rows = [
      { ...base, id: 's-1', event: 'clicked', metadata: null },
      { ...base, id: 's-2', event: 'staged', metadata: { followedSuggestion: true } },
    ] as any

    const snapshot = buildLearningSnapshotFromEvents(rows, { minActionEvents: 1 })

    expect(snapshot.totals.completed).toBe(0)
    expect(snapshot.totals.measurableOutcomes).toBe(0)
    const claim = snapshot.actionMetrics.find((m) => m.actionType === 'claim_player')
    expect(claim?.completed ?? 0).toBe(0)
  })
})
