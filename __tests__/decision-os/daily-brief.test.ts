/**
 * Fantasy OS Suite — Phase OS-B3: Daily Brief Composition Engine.
 *
 * `composeDailyBrief` is pure and zero-I/O — no Prisma or Decision OS resolver mocking needed. Covers
 * deterministic composition, priority ordering/capping, positive-highlight inclusion, league-highlight
 * filtering, recommended-action dedup, and the honest empty/healthy brief.
 */
import { describe, expect, it } from 'vitest'
import { composeDailyBrief, type DailyBriefInput, type DailyBriefLeagueTrend } from '@/lib/decision-os/dailyBrief'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

const NOW = new Date('2026-07-09T12:00:00Z')

function signal(o: Partial<DecisionOsAttentionSignal> & Pick<DecisionOsAttentionSignal, 'id' | 'leagueId' | 'severity' | 'type'>): DecisionOsAttentionSignal {
  return {
    priorityScore: SEVERITY_RANK[o.severity],
    title: 'Title',
    explanation: 'Explanation',
    recommendedAction: null,
    timestamp: NOW.toISOString(),
    source: 'league_health_engine',
    ...o,
  }
}

function baseInput(o: Partial<DailyBriefInput> = {}): DailyBriefInput {
  return {
    leaguesMonitored: 0,
    healthyLeagueCount: 0,
    draftsApproachingCount: 0,
    signals: [],
    leagueTrends: [],
    ...o,
  }
}

describe('composeDailyBrief — empty/healthy brief', () => {
  it('composes an honest, valid brief for a fully empty input — never an error state', () => {
    const brief = composeDailyBrief(baseInput(), NOW)
    expect(brief.isHealthy).toBe(true)
    expect(brief.overview).toEqual({
      leaguesMonitored: 0,
      leaguesNeedingAttention: 0,
      healthyLeagueCount: 0,
      draftsApproachingCount: 0,
    })
    expect(brief.topPriorityItems).toEqual([])
    expect(brief.leagueHighlights).toEqual([])
    expect(brief.positiveHighlights).toEqual([])
    expect(brief.recommendedActions).toEqual([])
    expect(brief.summary).toBe('Every league looks healthy today.')
  })

  it('is healthy when every signal present is merely informational', () => {
    const brief = composeDailyBrief(
      baseInput({
        signals: [signal({ id: 'a', leagueId: 'L1', severity: 'informational', type: 'high_league_health' })],
      }),
      NOW,
    )
    expect(brief.isHealthy).toBe(true)
    expect(brief.overview.leaguesNeedingAttention).toBe(0)
  })

  it('appends a real draft-count clause to the healthy summary when drafts are approaching', () => {
    const brief = composeDailyBrief(baseInput({ draftsApproachingCount: 2 }), NOW)
    expect(brief.summary).toBe('Every league looks healthy today. 2 drafts approaching.')
  })

  it('uses singular phrasing for exactly one league needing attention / one draft', () => {
    const brief = composeDailyBrief(
      baseInput({
        draftsApproachingCount: 1,
        signals: [signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'league_requires_review' })],
      }),
      NOW,
    )
    expect(brief.summary).toBe('1 league needs your attention today. 1 draft approaching.')
  })
})

describe('composeDailyBrief — priority ordering and capping', () => {
  it('sorts topPriorityItems by severity regardless of input order (never trusts caller ordering)', () => {
    const brief = composeDailyBrief(
      baseInput({
        signals: [
          signal({ id: 'low', leagueId: 'L1', severity: 'low', type: 'league_context_incomplete' }),
          signal({ id: 'critical', leagueId: 'L2', severity: 'critical', type: 'low_league_health' }),
          signal({ id: 'medium', leagueId: 'L3', severity: 'medium', type: 'low_league_health' }),
        ],
      }),
      NOW,
    )
    expect(brief.topPriorityItems.map((s) => s.id)).toEqual(['critical', 'medium', 'low'])
  })

  it('caps topPriorityItems at 5 even when more real signals exist', () => {
    const signals = Array.from({ length: 8 }, (_, i) =>
      signal({ id: `s${i}`, leagueId: `L${i}`, severity: 'critical', type: 'low_league_health' }),
    )
    const brief = composeDailyBrief(baseInput({ signals }), NOW)
    expect(brief.topPriorityItems).toHaveLength(5)
  })

  it('is deterministic: composing twice from the same input produces the same result', () => {
    const input = baseInput({
      signals: [
        signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' }),
        signal({ id: 'b', leagueId: 'L2', severity: 'critical', type: 'low_league_health' }),
      ],
    })
    const first = composeDailyBrief(input, NOW)
    const second = composeDailyBrief(input, NOW)
    expect(first).toEqual(second)
  })
})

describe('composeDailyBrief — recommended actions', () => {
  it('reuses recommendedAction strings from top-priority items, deduplicated, never inventing new ones', () => {
    const brief = composeDailyBrief(
      baseInput({
        signals: [
          signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health', recommendedAction: 'Review League Health.' }),
          signal({ id: 'b', leagueId: 'L2', severity: 'high', type: 'low_league_health', recommendedAction: 'Review League Health.' }),
          signal({ id: 'c', leagueId: 'L3', severity: 'low', type: 'league_context_incomplete', recommendedAction: 'Confirm financial status.' }),
        ],
      }),
      NOW,
    )
    expect(brief.recommendedActions).toEqual(['Review League Health.', 'Confirm financial status.'])
  })

  it('never surfaces a recommendedAction from a signal outside the top-priority cut', () => {
    const overflow = Array.from({ length: 5 }, (_, i) =>
      signal({ id: `top${i}`, leagueId: `L${i}`, severity: 'critical', type: 'low_league_health', recommendedAction: null }),
    )
    const excluded = signal({
      id: 'excluded',
      leagueId: 'L99',
      severity: 'low',
      type: 'league_context_incomplete',
      recommendedAction: 'Should never appear.',
    })
    const brief = composeDailyBrief(baseInput({ signals: [...overflow, excluded] }), NOW)
    expect(brief.recommendedActions).not.toContain('Should never appear.')
  })

  it('omits null recommendedAction values without producing an empty-string entry', () => {
    const brief = composeDailyBrief(
      baseInput({
        signals: [signal({ id: 'a', leagueId: 'L1', severity: 'informational', type: 'high_league_health', recommendedAction: null })],
      }),
      NOW,
    )
    expect(brief.recommendedActions).toEqual([])
  })
})

describe('composeDailyBrief — positive highlights', () => {
  it('includes only high_league_health signals as positive highlights', () => {
    const brief = composeDailyBrief(
      baseInput({
        signals: [
          signal({ id: 'a', leagueId: 'L1', severity: 'informational', type: 'high_league_health', title: 'League health is excellent' }),
          signal({ id: 'b', leagueId: 'L2', severity: 'high', type: 'low_league_health' }),
        ],
      }),
      NOW,
    )
    expect(brief.positiveHighlights).toEqual([{ leagueId: 'L1', title: 'League health is excellent', detail: 'Explanation' }])
  })

  it('is empty when no high_league_health signal exists', () => {
    const brief = composeDailyBrief(
      baseInput({ signals: [signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' })] }),
      NOW,
    )
    expect(brief.positiveHighlights).toEqual([])
  })
})

describe('composeDailyBrief — league highlights', () => {
  const trends: DailyBriefLeagueTrend[] = [
    { leagueId: 'L1', direction: 'increasing', eventCountDelta: 12 },
    { leagueId: 'L2', direction: 'flat', eventCountDelta: 0 },
    { leagueId: 'L3', direction: 'decreasing', eventCountDelta: -4 },
  ]

  it('excludes flat-direction trends — only leagues with real, meaningful activity change', () => {
    const brief = composeDailyBrief(baseInput({ leagueTrends: trends }), NOW)
    expect(brief.leagueHighlights.map((h) => h.leagueId)).toEqual(['L1', 'L3'])
  })

  it('preserves the real direction and delta values unchanged', () => {
    const brief = composeDailyBrief(baseInput({ leagueTrends: trends }), NOW)
    expect(brief.leagueHighlights).toEqual([
      { leagueId: 'L1', direction: 'increasing', eventCountDelta: 12 },
      { leagueId: 'L3', direction: 'decreasing', eventCountDelta: -4 },
    ])
  })

  it('omits the section entirely (empty array) when every trend is flat or absent', () => {
    const brief = composeDailyBrief(baseInput({ leagueTrends: [{ leagueId: 'L1', direction: 'flat', eventCountDelta: 0 }] }), NOW)
    expect(brief.leagueHighlights).toEqual([])
  })
})

describe('composeDailyBrief — multi-league aggregation', () => {
  it('aggregates leaguesNeedingAttention as a distinct-league count, not a signal count', () => {
    const brief = composeDailyBrief(
      baseInput({
        signals: [
          signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' }),
          signal({ id: 'b', leagueId: 'L1', severity: 'low', type: 'league_context_incomplete' }),
          signal({ id: 'c', leagueId: 'L2', severity: 'medium', type: 'draft_approaching' }),
        ],
      }),
      NOW,
    )
    expect(brief.overview.leaguesNeedingAttention).toBe(2)
  })

  it('reuses healthyLeagueCount/draftsApproachingCount/leaguesMonitored from the input unchanged', () => {
    const brief = composeDailyBrief(baseInput({ leaguesMonitored: 7, healthyLeagueCount: 5, draftsApproachingCount: 3 }), NOW)
    expect(brief.overview).toMatchObject({ leaguesMonitored: 7, healthyLeagueCount: 5, draftsApproachingCount: 3 })
  })
})
